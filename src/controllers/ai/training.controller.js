// controllers/aiTrainingController.js
const mongoose = require('mongoose');
const aiService = require('../../services/aiService'); 

const logger = require('../../utils/logger');
const { getModel } = require('../../utils/modelProvider');
const User = getModel('User');
const Lead = getModel('Lead');
const SyntheticConversation = getModel('SyntheticConversation');
const ConversationInsight = getModel('ConversationInsight');
const aiSimulationService = require('../../services/ai/aiSimulationService');

const fs = require('fs/promises'); 



// ==========================================================
// --- 1. SIMULAÇÃO DE RESPOSTA DA IA (POST /simulate-response) ---
// ==========================================================
// ✨ --- FUNÇÃO MODIFICADA --- ✨
exports.simulateAIResponse = async (req, res, next) => {
  try {
    // --- Recebe a metodologia do frontend ---
    const { 
      conversationHistory, 
      currentState, 
      currentLeadStatus, 
      selectedMethodology // <-- NOVO
    } = req.body;
    const userId = req.user.id;

    if (!conversationHistory || !Array.isArray(conversationHistory)) {
      return res.status(400).json({ message: 'conversationHistory (array) é obrigatório.' });
    }

    const user = await User.findById(userId).select('+settings');
    if (!user) {
      return res.status(404).json({ message: 'Usuário não encontrado.' });
    }

    // Monta objetos simulados
    const simulatedConversation = {
      messages: conversationHistory.map(msg => ({
         role: msg.role === 'assistant' ? 'ai' : 'human',
         content: msg.content,
         channel: 'chat'
      })),
      conversationState: currentState || 'DISCOVERY',
    };

    const simulatedLeadData = {
      _id: new mongoose.Types.ObjectId(), // ID Mongoose falso
      name: 'Lead Simulado',
      company: 'Empresa Teste',
      position: 'Gerente de Vendas',
      status: currentLeadStatus || 'contatado',
      user: userId
    };

    logger.info(`[Simulador IA] User ${userId} chamando aiService.generateResponse. Metodologia: ${selectedMethodology || 'Default'}`);

    // --- Passa a metodologia para o serviço ---
    const aiResult = await aiService.generateResponse(
      simulatedConversation,
      simulatedLeadData,
      user,
      selectedMethodology // <-- NOVO PARÂMETRO
    );

    res.json({
      reply: aiResult.reply,
      conversationState: aiResult.conversationState,
      leadStatus: aiResult.leadStatus
    });

  } catch (error) {
    logger.error('[Simulador IA] Erro fatal ao simular resposta da IA:', error);
    next(error);
  }
};
// --- FIM DA MODIFICAÇÃO ---

// ==========================================================
// --- 2. UPLOAD E ANÁLISE DE DOCUMENTOS (POST /upload-document) ---
// ==========================================================
exports.handleDocumentUpload = async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ message: 'Nenhum arquivo encontrado no upload.' });
  }

  const { originalname, mimetype, path: filePath } = req.file;
  const userId = req.user.id;
  let documentText = '';
  let insightsAdded = 0;

  try {
    // 1. Extração de Texto baseada no MIME type
    if (mimetype === 'text/plain') {
      documentText = await fs.readFile(filePath, 'utf-8');
    } else if (mimetype === 'application/pdf') {
      try {
        const pdf = require('pdf-parse');
        documentText = (await pdf(await fs.readFile(filePath))).text;
      } catch (pdfError) {
        logger.warn('pdf-parse não disponível. Lendo como texto bruto.');
        documentText = await fs.readFile(filePath, 'utf-8');
      }
    } else if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
      try {
        const mammoth = require('mammoth');
        documentText = (await mammoth.extractRawText({ path: filePath })).value;
      } catch (docxError) {
        logger.warn('mammoth não disponível. Lendo como texto bruto.');
        documentText = await fs.readFile(filePath, 'utf-8');
      }
    } else {
      throw new Error('Tipo de arquivo não suportado para análise. Suporta: .txt, .pdf, .docx.');
    }
    
    if (documentText.length < 50) {
        throw new Error('O texto extraído é muito curto ou vazio para ser analisado pela IA.');
    }

    // 2. Análise do Texto com IA (Gemini)
    const analysisResult = await aiService.analyzeDocumentForInsights(documentText, originalname);

    // 3. Armazenamento dos insights no banco
    if (analysisResult && analysisResult.keyInsights && analysisResult.keyInsights.length > 0) {
      const insight = new ConversationInsight({
        user: userId,
        type: 'document',
        success: true,
        summary: analysisResult.summary || `Análise do documento: ${originalname}`,
        keyPoints: analysisResult.keyInsights,
        effectiveStrategies: analysisResult.actionableAdvice || [],
        tags: analysisResult.tags || [],
        source: 'document_upload',
        rawData: { fileName: originalname, textLength: documentText.length },
      });
      await insight.save();
      insightsAdded = analysisResult.keyInsights.length;
      logger.info(`[Upload Insight] ${insightsAdded} insights extraídos do documento "${originalname}" para o usuário ${userId}.`);
    }

    res.json({
      fileName: originalname,
      insightsAdded: insightsAdded,
      summary: analysisResult?.summary || '',
      insights: analysisResult?.keyInsights || [],
      tags: analysisResult?.tags || [],
      message: `Documento processado com sucesso. ${insightsAdded} insight(s) extraído(s).`
    });

  } catch (error) {
    logger.error(`[Upload Insight] Erro ao processar documento ${originalname}:`, error);
    res.status(500).json({ message: `Falha ao processar o arquivo: ${error.message}` });
  } finally {
    // 4. Limpeza (Deletar o arquivo temporário)
    await fs.unlink(filePath).catch(err => logger.warn(`Falha ao deletar arquivo temporário: ${err.message}`));
  }
};

// ==========================================================
// --- 3. MÉTRICAS DO GRÁFICO (GET /metrics) ---
// ==========================================================
// ✨ --- FUNÇÃO CORRIGIDA --- ✨
exports.getLearningMetrics = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const sevenWeeksAgo = new Date();
    sevenWeeksAgo.setDate(sevenWeeksAgo.getDate() - 49); // 7 semanas atrás

    // 1. MUDANÇA: Ler da coleção 'syntheticconversations' em vez de 'leads'
    const allSimulations = await SyntheticConversation.aggregate([
      // Filtra simulações do usuário logado e que foram criadas no período
      { $match: { 
        user: new mongoose.Types.ObjectId(userId), 
        createdAt: { $gte: sevenWeeksAgo } // MUDANÇA: Usar createdAt
      }},
      
      // Agrupa por semana e calcula totais
      { $group: {
        _id: { 
          year: { $year: "$createdAt" }, // MUDANÇA: Usar createdAt
          week: { $week: "$createdAt" } // MUDANÇA: Usar $week (compatível com Mongo local)
        },
        totalSims: { $sum: 1 }, // MUDANÇA: 'totalSims'
        totalQualified: { $sum: { $cond: [ 
          { $in: ["$finalLeadStatus", ["qualificado", "CONVERTED"]] }, // MUDANÇA: Usar finalLeadStatus
          1, 
          0 
        ] } }
      }},
      { $sort: { "_id.year": 1, "_id.week": 1 } }
    ]);
    
    // 2. Processar os dados para o formato do Chart.js (6 últimas semanas)
    const metricsMap = new Map();
    allSimulations.forEach(item => {
        const key = `Y${item._id.year}W${item._id.week}`; // A semana do $week começa em 0
        metricsMap.set(key, item);
    });
    
    const labels = [];
    const successRate = [];
    const today = new Date();

    // Função helper para pegar a semana (começando de 0, como o $week do mongo)
    const getWeekOfYear = (date) => {
      const start = new Date(date.getFullYear(), 0, 1);
      // Calcula a diferença de dias
      const diff = (date - start) + ((start.getTimezoneOffset() - date.getTimezoneOffset()) * 60 * 1000);
      const oneDay = 1000 * 60 * 60 * 24;
      const day = Math.floor(diff / oneDay);
      // Retorna a semana (base 0)
      return Math.floor((day + start.getDay()) / 7);
    }
    
    // Gera os rótulos das últimas 6 semanas
    for (let i = 5; i >= 0; i--) {
        const date = new Date(today);
        date.setDate(today.getDate() - (i * 7));
        
        const weekNumber = getWeekOfYear(date); // MUDANÇA: Usando lógica de $week
        const year = date.getFullYear();
        const key = `Y${year}W${weekNumber}`;
        
        labels.push(`Sem ${weekNumber + 1}`); // +1 para display (Sem 1, Sem 2...)
        
        const data = metricsMap.get(key);
        if (data && data.totalSims > 0) { // MUDANÇA: totalSims
            const rate = (data.totalQualified / data.totalSims) * 100; // MUDANÇA: totalSims
            successRate.push(Math.round(rate));
        } else {
            successRate.push(0); // 0% se não houver simulações
        }
    }

    // 3. Tamanho da Memória (Nº de Insights)
    // (Lendo insights de sucesso que vieram de uma simulação de lead)
    const totalInsights = await ConversationInsight.countDocuments({ 
      success: true, 
      leadId: { $exists: true } 
    }); 

    res.json({
      labels: labels,
      successRate: successRate,
      totalInsights: totalInsights
    });

  } catch (error) {
    logger.error('[Métricas IA] Erro ao buscar métricas de aprendizado:', error);
    res.status(500).json({
        labels: ['Erro'],
        successRate: [0],
        totalInsights: 0,
        message: 'Falha ao carregar métricas.'
    });
  }
};
// --- FIM DA CORREÇÃO ---


// ==========================================================
// --- 4. INICIAR TREINAMENTO SINTÉTICO (POST /run-synthetic-training) ---
// ==========================================================
exports.runSyntheticTraining = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    // Espera o ciclo terminar para responder
    const result = await aiSimulationService.startTrainingCycle(userId);

    res.status(200).json(result); 

  } catch (error) {
    logger.error('[AI Treino Sintético] Erro ao disparar ciclo:', error);
    next(error);
  }
};

// ==========================================================
// --- 5. BUSCAR CONVERSAS SINTÉTICAS (GET /synthetic-conversations) ---
// ==========================================================
exports.getSyntheticConversations = async (req, res, next) => {
  try {
    const userId = req.user.id;
    
    const conversations = await SyntheticConversation.find({ user: userId })
      .sort({ createdAt: -1 })
      .limit(50); 

    res.status(200).json(conversations);

  } catch (error) {
    logger.error('[AI Treino Sintético] Erro ao buscar conversas sintéticas:', error);
    next(error);
  }
};

// ==========================================================
// --- 6. DELETAR UM LOG SINTÉTICO (DELETE /synthetic-conversations/:id) ---
// ==========================================================
exports.deleteSingleSyntheticConversation = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const log = await SyntheticConversation.findById(id);

    if (!log) {
      return res.status(404).json({ message: 'Log de conversa não encontrado.' });
    }
    if (log.user.toString() !== userId) {
      return res.status(403).json({ message: 'Você não tem permissão para deletar este log.' });
    }

    await SyntheticConversation.findByIdAndDelete(id);
    res.status(200).json({ message: 'Log de conversa deletado com sucesso.' });

  } catch (error) {
    logger.error('[AI Treino Sintético] Erro ao deletar log individual:', error);
    next(error);
  }
};

// ==========================================================
// --- 7. DELETAR TODOS OS LOGS (DELETE /synthetic-conversations/all) ---
// ==========================================================
exports.deleteAllSyntheticConversations = async (req, res, next) => {
  try {
    const userId = req.user.id;
    const deleteResult = await SyntheticConversation.deleteMany({ user: userId });

    if (deleteResult.deletedCount === 0) {
      return res.status(404).json({ message: 'Nenhum log para deletar.' });
    }

    res.status(200).json({ 
      message: `Todos os ${deleteResult.deletedCount} logs de conversas foram deletados.`,
      deletedCount: deleteResult.deletedCount
    });

  } catch (error) {
    logger.error('[AI Treino Sintético] Erro ao deletar todos os logs:', error);
    next(error);
  }
};

// ==========================================================
// --- 8. OBTER STATUS DO TREINAMENTO (GET /synthetic-training/status) ---
// ==========================================================
exports.getSyntheticTrainingStatus = async (req, res, next) => {
  try {
    const status = aiSimulationService.getStatus();
    res.status(200).json(status);
  } catch (error) {
    logger.error('[AI Treino Sintético] Erro ao obter status:', error);
    next(error);
  }
};