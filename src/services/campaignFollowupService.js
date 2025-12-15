// services/campaignFollowupService.js

const Campaign = require('../models/Campaign');
const logger = require('../utils/logger');
const aiController = require('../controllers/aiController');
const { io } = require('../server');

class CampaignFollowupService {
  async processCampaignFollowups() {
    try {
      const now = new Date();
      
      const query = {
        status: 'running',
        'followUp.enabled': true,
        'contacts.followUpStatus.nextAttemptAt': { $lte: now }
      };
      
      const activeCampaigns = await Campaign.find(query).populate('user').populate('whatsappInstance');

      if (!activeCampaigns.length) {
        return;
      }

      for (const campaign of activeCampaigns) {
        const contactsToSend = campaign.contacts.filter(contact =>
          contact.followUpStatus &&
          contact.followUpStatus.nextAttemptAt &&
          contact.followUpStatus.nextAttemptAt <= now &&
          contact.followUpStatus.attempts < campaign.followUp.maxAttempts &&
          contact.status !== 'replied' &&
          contact.status !== 'failed'
        );

        if (contactsToSend.length > 0) {
            for (const contact of contactsToSend) {
              try {
                const message = campaign.followUp.messageTemplate.replace(/{{nome}}/g, contact.name);
                await aiController.sendMessageToChannel(
                  { phone: contact.phone, email: contact.email, _id: contact._id },
                  { type: 'text', content: message },
                  campaign.channel,
                  campaign.user.settings,
                  campaign.whatsappInstance
                );
    
                contact.followUpStatus.attempts += 1;
                
                if (contact.followUpStatus.attempts < campaign.followUp.maxAttempts) {
                  const nextAttempt = new Date();
                  if (campaign.followUp.delayUnit === 'days') {
                    nextAttempt.setDate(nextAttempt.getDate() + campaign.followUp.delay);
                  } else {
                    nextAttempt.setHours(nextAttempt.getHours() + campaign.followUp.delay);
                  }
                  contact.followUpStatus.nextAttemptAt = nextAttempt;
                } else {
                  contact.followUpStatus.nextAttemptAt = null;
                }
              } catch (error) {
                logger.error(`[C-FOLLOWUP] Falha ao enviar follow-up para "${contact.name}":`, error);
              }
            }
        }
        
        const pendingFollowUps = campaign.contacts.some(
            contact => contact.followUpStatus?.nextAttemptAt
        );

        const allInitialSent = campaign.contacts.every(
            contact => ['sent', 'delivered', 'read', 'replied', 'failed'].includes(contact.status)
        );

        if (!pendingFollowUps && allInitialSent) {
            campaign.status = 'completed';
            campaign.completedAt = new Date();
            logger.info(`[C-FOLLOWUP] Campanha '${campaign.name}' finalizada. Nenhum follow-up pendente.`);
        }

        await campaign.save();

        if (io) {
            io.to(`user-${campaign.user._id.toString()}`).emit('campaign_updated', { campaign });
        }
      }
    }
    catch (error) {
      logger.error('[C-FOLLOWUP] Erro geral no serviço:', error);
    }
  }

  scheduleFirstFollowup(campaign, contact) {
    if (campaign.followUp.enabled && campaign.followUp.delay > 0) {
      const firstAttempt = new Date();
      if (campaign.followUp.delayUnit === 'days') {
        firstAttempt.setDate(firstAttempt.getDate() + campaign.followUp.delay);
      } else {
        firstAttempt.setHours(firstAttempt.getHours() + campaign.followUp.delay);
      }
      
      contact.followUpStatus = {
        attempts: 0,
        nextAttemptAt: firstAttempt
      };
    }
    return contact;
  }
}

module.exports = new CampaignFollowupService();