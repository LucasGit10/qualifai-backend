const { getModel } = require('../../utils/modelProvider');
const mongoose = require('mongoose');
const Conversation = getModel('Conversation');
const Lead = getModel('Lead');
const WhatsAppInstance = getModel('WhatsAppInstance');
const negotiationIntelligenceService = require('../../services/negotiationIntelligenceService');
const { consolidateOpenDuplicatesForUser } = require('../../services/conversationReuseService');
const logger = require('../../utils/logger');

class ConversationController {
  // Listar conversas
  // Dentro da função getConversations no ConversationController
  async getConversations(req, res) {
    try {
      const { page = 1, limit = 16, status, channel, owner = 'master', teamMemberId } = req.query;
      const userId = req.user.id;

      await consolidateOpenDuplicatesForUser(userId);

	      const filter = { user: userId };
	      if (status) filter.status = status;
	      if (channel) filter.channel = channel;
	      if (teamMemberId) {
	        filter.conversationOwnerType = 'teamMember';
	        filter.assignedTeamMember = teamMemberId;
	      } else if (owner === 'master') {
	        filter.conversationOwnerType = 'master';
	      }

      const conversations = await Conversation.find(filter)
        .populate('lead', 'name phone email company taxId address')
        // Adicionar o populate para a instância
	        .populate('instance', 'instanceName phoneNumber')
	        .populate('assignedTeamMember', 'name roleLabel')
        .sort({ handedOffToHuman: -1, lastMessageAt: -1, updatedAt: -1 })
        .limit(limit * 1)
        .skip((page - 1) * limit);

      const total = await Conversation.countDocuments(filter);
      const aggregateFilter = { ...filter, user: new mongoose.Types.ObjectId(userId) };
      const unreadAggregate = await Conversation.aggregate([
        { $match: aggregateFilter },
        { $group: { _id: null, totalUnread: { $sum: { $ifNull: ['$unreadCount', 0] } } } }
      ]);

      res.json({
        conversations,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total,
        totalUnread: unreadAggregate[0]?.totalUnread || 0
      });
    } catch (error) {
      logger.error('Erro ao listar conversas:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
	  }

  async assignLegacyToMaster(req, res) {
    try {
      const userId = req.user.id;
      const result = await Conversation.updateMany(
        {
          user: userId,
          $or: [
            { conversationOwnerType: { $exists: false } },
            { conversationOwnerType: null },
            { conversationOwnerType: '' }
          ]
        },
        {
          $set: { conversationOwnerType: 'master' },
          $unset: { assignedTeamMember: '' }
        }
      );

      req.app.get('io')?.to(`user-${userId}`).emit('conversation_updated', {});

      res.json({
        success: true,
        modifiedCount: result.modifiedCount || 0,
        message: `${result.modifiedCount || 0} conversas antigas associadas ao usuario mestre.`
      });
    } catch (error) {
      logger.error('Erro ao associar conversas antigas ao mestre:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

	  // Buscar conversa por ID
	  async getConversationById(req, res) {
    try {
      const conversation = await Conversation.findOne({
        _id: req.params.id,
        user: req.user.id
      })
      .populate('lead', 'name email company phone position taxId address')
      .populate('instance', 'instanceName phoneNumber')
      .populate('assignedTeamMember', 'name roleLabel'); // <--- Adicione esta linha

      if (!conversation) {
        return res.status(404).json({ message: 'Conversa não encontrada' });
      }

      res.json({ conversation });
    } catch (error) {
      logger.error('Erro ao buscar conversa:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Buscar conversas por lead
  async getConversationsByLead(req, res) {
    try {
      const conversations = await Conversation.find({
        lead: req.params.leadId,
        user: req.user.id
      }).sort('-createdAt');

      res.json({ conversations });
    } catch (error) {
      logger.error('Erro ao buscar conversas do lead:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Atualizar status da conversa
  async updateConversationStatus(req, res) {
    try {
      const { status } = req.body;
      
      const conversation = await Conversation.findOneAndUpdate(
        { _id: req.params.id, user: req.user.id },
        { status, endedAt: status === 'closed' ? new Date() : undefined },
        { new: true }
      );

      if (!conversation) {
        return res.status(404).json({ message: 'Conversa não encontrada' });
      }

      res.json({ conversation });
    } catch (error) {
      logger.error('Erro ao atualizar conversa:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Adicionar nota à conversa
  async markAsRead(req, res) {
    try {
      const conversation = await Conversation.findOneAndUpdate(
        { _id: req.params.id, user: req.user.id },
        { unreadCount: 0, lastReadAt: new Date() },
        { new: true }
      )
      .populate('lead', 'name email company phone position taxId address')
      .populate('instance', 'instanceName phoneNumber');

      if (!conversation) {
        return res.status(404).json({ message: 'Conversa nÃ£o encontrada' });
      }

      req.app.get('io')?.to(`user-${req.user.id}`).emit('conversation_updated', { conversation });

      res.json({ success: true, conversation });
    } catch (error) {
      logger.error('Erro ao marcar conversa como lida:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async addNote(req, res) {
    try {
      const { content } = req.body;
      
      if (!content || typeof content !== 'string') {
        return res.status(400).json({ message: 'Conteúdo da nota inválido' });
      }

      const conversation = await Conversation.findOneAndUpdate(
        { 
          _id: req.params.id,
          user: req.user.id 
        },
        { 
          $push: { 
            notes: content,
            messages: {
              role: 'system',
              content: `[NOTA] ${content}`,
              channel: '$channel'
            }
          }
        },
        { 
          new: true,
          setDefaultsOnInsert: true
        }
      ).lean();

      if (!conversation) {
        return res.status(404).json({ message: 'Conversa não encontrada' });
      }

      // Atualização pós-save para garantir o channel correto
      await Conversation.updateOne(
        { _id: conversation._id, 'messages._id': conversation.messages.slice(-1)[0]._id },
        { $set: { 'messages.$.channel': conversation.channel } }
      );

      res.json({ 
        success: true,
        conversation: {
          ...conversation,
          messages: conversation.messages.map(msg => ({
            ...msg,
            channel: msg.channel === '$channel' ? conversation.channel : msg.channel
          }))
        }
      });
    } catch (error) {
      logger.error('Erro ao adicionar nota:', error);
      res.status(500).json({ 
        message: 'Erro interno do servidor',
        details: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async analyzeNegotiation(req, res) {
    try {
      const { id } = req.params;
      const userId = req.user.id;

      const { intelligence, conversation } = await negotiationIntelligenceService.refreshConversation({
        conversationId: id,
        userId,
        io: req.app.get('io'),
      });

      res.json({
        success: true,
        intelligence,
        conversation,
      });
    } catch (error) {
      logger.error('Erro ao analisar negociacao:', error);
      res.status(error.statusCode || 500).json({ message: error.message || 'Erro interno do servidor' });
    }
  }

  // Método genérico para atualizar conversa
  async updateConversation(req, res) {
    try {
      const { id } = req.params;
      const updates = req.body;
      const userId = req.user.id;

      const conversation = await Conversation.findOne({ _id: id, user: userId });

      if (!conversation) {
        return res.status(404).json({ message: 'Conversa não encontrada' });
      }

      // Se o status da IA está sendo alterado, adiciona uma nota
      if (updates.aiEnabled !== undefined && updates.aiEnabled !== conversation.aiEnabled) {
        const noteContent = `[SISTEMA] A IA foi ${updates.aiEnabled ? 'ativada' : 'desativada'} para esta conversa.`;
        conversation.messages.push({
          role: 'system',
          content: noteContent,
          channel: conversation.channel,
        });
      }

      // Aplica as atualizações
      Object.keys(updates).forEach(key => {
        conversation[key] = updates[key];
      });

      const updatedConversation = await conversation.save();

      res.json({
        success: true,
        message: 'Conversa atualizada com sucesso.',
        conversation: updatedConversation
      });
    } catch (error) {
      logger.error('Erro ao atualizar conversa:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
  async getNotes(req, res) {
    try {
      const notes = await Conversation.findOne(
        { 
          _id: req.params.id,
          user: req.user.id 
        },
        { notes: 1 }
      );

      if (!notes) {
        return res.status(404).json({ message: 'Conversa não encontrada' });
      }

      res.json({ 
        notes: notes.notes || [],
        success: true 
      });
    } catch (error) {
      logger.error('Erro ao buscar notas:', error);
      res.status(500).json({ 
        message: 'Erro interno do servidor',
        error: process.env.NODE_ENV === 'development' ? error.message : undefined
      });
    }
  }

  async deleteConversation(req, res) {
    try {
      const { id } = req.params
      const userId = req.user.id;
      const conversation = await Conversation.findOneAndDelete({
        _id: id,
        user: userId
      });

      if (!conversation) {
        return res.status(404).json({ message: 'Conversa não encontrada' });
      }

      res.json({
        success: true,
        message: 'Conversa deletada com sucesso.'
      });
    } catch (error) {
      logger.error('Erro ao deletar conversa:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

}

module.exports = new ConversationController();
