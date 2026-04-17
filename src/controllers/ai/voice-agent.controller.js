/**
 * VoiceAgentController.js
 * * VERSÃO SEM STREAMING (Webhooks)
 * - MODIFICADO (Etapa 6): Agora entende o sinal "proposeScheduling: true"
 * do aiService e busca horários ativamente.
 */

const twilio = require('twilio');
const logger = require('../../utils/logger');
const { VoiceResponse } = twilio.twiml;
const axios = require('axios');

const OneSignalService = require('../../services/oneSignalService');
const aiService = require('../../services/aiService');
const ttsService = require('../../services/textToSpeechService');
const Lead = require('../../models/Lead');
const User = require('../../models/User');
const Conversation = require('../../models/Conversation');

// ==========================================================
// CONFIGURAÇÃO
// ==========================================================
const FALLBACK_VOICE = 'Polly.Camila-Neural';
const FILLER_PHRASES = [
  "Ah, claro, deixa eu ver...",
  "Entendi... só um segundo.",
  "Certo, certo...",
  "Sei...",
  "Ok, pensando aqui...",
  "Hmm, boa pergunta."
];
const RECORD_MAX_LENGTH = 10;
const RECORD_TIMEOUT = 4;
// ==========================================================


class VoiceAgentController {
  constructor() {
    this.startCall = this.startCall.bind(this);
    this.generateTwiml = this.generateTwiml.bind(this);
    this.handleRecording = this.handleRecording.bind(this); 
    this.thinkAndRespond = this.thinkAndRespond.bind(this);
    this.handleCallStatus = this.handleCallStatus.bind(this);
  }

  // ==========================================================
  // --- _getTwilioClient (Mantido) ---
  // ==========================================================
  _getTwilioClient(twilioConfig) {
    if (!twilioConfig || !twilioConfig.twilioAccountSid || !twilioConfig.twilioAuthToken || !twilioConfig.twilioPhoneNumber) {
      logger.error('CRITICAL: O usuário não possui configurações completas da Twilio (SID, Token e Número).');
      return null;
    }
    if (!twilioConfig.twilioAccountSid.startsWith('AC')) {
      logger.error(`CRITICAL: TWILIO_ACCOUNT_SID inválido (${twilioConfig.twilioAccountSid}).`);
      return null;
    }
    return twilio(twilioConfig.twilioAccountSid, twilioConfig.twilioAuthToken);
  }

  // ==========================================================
  // --- _speakOrFallback (Mantido) ---
  // ==========================================================
  async _speakOrFallback(twiml, textToSpeak) {
    if (!textToSpeak || textToSpeak.trim() === '') {
      logger.warn('[Controller] Tentativa de falar texto vazio. Ignorando.');
      return;
    }
    try {
      const audioUrl = await ttsService.generateClonedVoiceAudio(textToSpeak);
      if (audioUrl) {
        twiml.play(audioUrl);
      } else {
        logger.warn(`[Controller] Falha no ttsService. Usando fallback Polly para: "${textToSpeak}"`);
        twiml.say({ voice: FALLBACK_VOICE, language: 'pt-BR' }, textToSpeak);
      }
    } catch (error) {
      logger.error(`[Controller] Erro crítico no _speakOrFallback: ${error.message}`);
      twiml.say({ voice: FALLBACK_VOICE, language: 'pt-BR' }, textToSpeak);
    }
  }

  // ==========================================================
  // --- 1. startCall (Mantido) ---
  // ==========================================================
  async startCall(req, res) {
    const { phoneNumber, initialMessage } = req.body;
    const publicUrl = process.env.PUBLIC_URL;
    const userId = req.user.id; 

    try {
      const user = await User.findById(userId);
      if (!user) return res.status(404).json({ message: 'Usuário não encontrado.' });
      const twilioConfig = user.settings?.twilioConfig;
      const twilioClient = this._getTwilioClient(twilioConfig);
      if (!twilioClient) {
        return res.status(400).json({ message: 'Integração Twilio inválida.' });
      }
      const from = twilioConfig.twilioPhoneNumber;
      if (!phoneNumber || !from || !publicUrl) {
        return res.status(400).json({ message: 'Dados obrigatórios ausentes.' });
      }
      const normalizedPhone = phoneNumber.replace(/^\+/, '');
      const lead = await Lead.findOne({ phone: normalizedPhone, user: userId });
      if (!lead) return res.status(404).json({ message: 'Lead não encontrado.' });
      let conversation = await Conversation.findOne({ lead: lead._id, channel: 'voice' });
      if (!conversation) {
        conversation = new Conversation({
          lead: lead._id,
          user: userId,
          channel: 'voice',
          status: 'active',
          messages: []
        });
      }
      const finalMessage = initialMessage || `Olá ${lead.name}, aqui é da QualifAI. Tudo bem?`;
      conversation.messages.push({ role: 'ai', content: finalMessage, channel: 'voice' });
      await conversation.save();
      const twimlUrl = `${publicUrl}/api/voice-agent/twiml?conversationId=${conversation._id}`;
      const statusCallbackUrl = `${publicUrl}/api/voice-agent/status?conversationId=${conversation._id}`;
      
      await twilioClient.calls.create({ 
        to: phoneNumber, 
        from, 
        url: twimlUrl,
        statusCallback: statusCallbackUrl,
        statusCallbackEvent: ['completed', 'busy', 'no-answer', 'failed', 'canceled']
      });
      res.status(200).json({ message: 'Chamada iniciada com sucesso.' });
    } catch (error) {
      logger.error('Erro ao iniciar chamada Twilio:', error);
      res.status(500).json({ message: `Falha ao iniciar chamada: ${error.message}` });
    }
  }

  // ==========================================================
  // --- handleCallStatus ---
  // ==========================================================
  async handleCallStatus(req, res) {
    const { conversationId } = req.query;
    const { CallStatus } = req.body;

    try {
      if (['no-answer', 'failed', 'busy', 'canceled'].includes(CallStatus)) {
        const conversation = await Conversation.findById(conversationId).populate('lead');
        if (conversation && conversation.user) {
          const OneSignalService = require('../../services/oneSignalService');
          OneSignalService.sendPushNotification(
            conversation.user.toString(),
            'Chamada Não Atendida',
            `O contato ${conversation.lead?.name || 'Lead'} não atendeu a ligação da IA (Status: ${CallStatus}).`,
            { type: 'voice', link: `/app/debts` }
          );
        }
      }
      res.status(200).send('Status received');
    } catch (e) {
      logger.error('Erro ao processar status da chamada:', e);
      res.status(500).send('Erro interno');
    }
  }

  // ==========================================================
  // --- 2. generateTwiml (Mantido) ---
  // ==========================================================
  async generateTwiml(req, res) {
    const { conversationId } = req.query;
    if (!conversationId) return res.status(400).send('conversationId ausente');
    try {
      const conversation = await Conversation.findById(conversationId);
      if (!conversation) return res.status(404).send('Conversa não encontrada');
      const lastMessage = conversation.messages.at(-1) || { content: 'Olá, tudo bem?' };
      const twiml = new VoiceResponse();
      await this._speakOrFallback(twiml, lastMessage.content); 
      const actionUrl = `${process.env.PUBLIC_URL}/api/voice-agent/handle-recording?conversationId=${conversationId}`;
      twiml.record({
        action: actionUrl,
        method: 'POST',
        maxLength: RECORD_MAX_LENGTH,
        playBeep: false,
        timeout: RECORD_TIMEOUT,
      });
      twiml.say("Desculpe, não consegui te ouvir. Poderia repetir?");
      twiml.redirect({ method: 'POST' }, actionUrl);
      res.type('text/xml');
      res.send(twiml.toString());
    } catch (error) {
      logger.error(`Erro ao gerar TwiML: ${error.message}`);
      res.status(500).send('Erro interno ao gerar TwiML');
    }
  }

  // ==========================================================
  // --- 3. handleRecording (Mantido) ---
  // ==========================================================
  async handleRecording(req, res) {
    const { conversationId } = req.query;
    const { RecordingUrl, RecordingDuration } = req.body;
    let userSpeech = '[Silêncio]';

    try {
      const conversation = await Conversation.findById(conversationId)
                                            .populate('lead')
                                            .populate('user');
      if (!conversation) return res.status(404).send('Conversation not found');
      if (!conversation.user || !conversation.user.settings?.twilioConfig) {
           logger.error(`[handleRecording] Usuário ou configuração Twilio não encontrados para conversationId: ${conversationId}`);
           return res.status(500).send('Erro interno: Configuração do usuário não encontrada.');
      }
      const twilioConfig = conversation.user.settings.twilioConfig;
      if (RecordingUrl && RecordingDuration && parseInt(RecordingDuration, 10) > 0) {
        logger.info(`[Whisper STT] Baixando áudio de: ${RecordingUrl}`);
        const response = await axios.get(RecordingUrl, { 
            responseType: 'arraybuffer',
            auth: {
              username: twilioConfig.twilioAccountSid,
              password: twilioConfig.twilioAuthToken
            }
        });
        const audioBuffer = Buffer.from(response.data);
        const transcription = await aiService.speechToText(audioBuffer); // Corrigido para 'pt'
        if (transcription && transcription.trim() !== "") {
          userSpeech = transcription;
        } else {
          userSpeech = '[Incompreensível]';
        }
        logger.info(`[Whisper STT] Transcrição: "${userSpeech}"`);
      } else {
        logger.info('[Whisper STT] Nenhuma gravação detectada (silêncio).');
        userSpeech = '[Silêncio]';
      }
      conversation.messages.push({ role: 'lead', content: userSpeech, channel: 'voice' });
      const twiml = new VoiceResponse();
      const goodbyeWords = ['tchau', 'adeus', 'até logo', 'não quero', 'pode desligar', 'não tenho interesse'];
      const actionUrl = `${process.env.PUBLIC_URL}/api/voice-agent/handle-recording?conversationId=${conversationId}`;
      if (goodbyeWords.some(w => userSpeech.toLowerCase().includes(w))) {
         const byeMsg = 'Entendido. Tenha um ótimo dia, até logo!';
        await this._speakOrFallback(twiml, byeMsg);
        twiml.hangup();
        conversation.status = 'closed';
        // --- AUTO-TREINAMENTO (Gatilho de Desligamento) ---
        // (Adicionado para garantir que conversas curtas e negativas também sejam analisadas)
        aiService._analyzeConversation(conversation, conversation.lead)
          .then(analysis => {
            if (analysis) aiService._vectorizeAndStore(analysis, conversation._id, conversation.lead._id);
          })
          .catch(err => logger.error(`[Auto-Treinamento] Falha ao analisar (handleRecording) ${conversation._id}:`, err));
        // --- FIM ---
      } else if (userSpeech === '[Silêncio]' || userSpeech === '[Incompreensível]') {
        const msg = 'Desculpe, eu não ouvi nada. Você ainda está aí?';
        await this._speakOrFallback(twiml, msg);
        twiml.record({ action: actionUrl, method: 'POST', maxLength: RECORD_MAX_LENGTH, playBeep: false, timeout: RECORD_TIMEOUT });
        twiml.redirect({ method: 'POST' }, actionUrl);
      } else {
        const filler = FILLER_PHRASES[Math.floor(Math.random() * FILLER_PHRASES.length)];
        await this._speakOrFallback(twiml, filler);
        const thinkUrl = `${process.env.PUBLIC_URL}/api/voice-agent/think?conversationId=${conversationId}`;
        twiml.redirect({ method: 'POST' }, thinkUrl);
      }
      await conversation.save();
      res.type('text/xml');
      res.send(twiml.toString());
    } catch (error) {
      if (axios.isAxiosError(error)) {
        logger.error(`Erro Axios em handleRecording ao buscar ${RecordingUrl}: ${error.message}`);
      } else {
          logger.error('Erro em handleRecording:', error);
      }
      const twimlError = new VoiceResponse();
      twimlError.say("Desculpe, ocorreu um erro interno. Por favor, tente ligar novamente mais tarde.");
      twimlError.hangup();
      res.type('text/xml');
      res.status(500).send(twimlError.toString());
    }
  }


  // ==========================================================
  // --- 4. thinkAndRespond (MODIFICADO) ---
  // ==========================================================
  async thinkAndRespond(req, res) {
    const { conversationId } = req.query;

    try {
      const conversation = await Conversation.findById(conversationId).populate('lead').populate('user');
      if (!conversation) return res.status(404).send('Conversation not found');
      if (!conversation.user || !conversation.lead) return res.status(500).send('User or Lead not found for conversation');

      // 1. Chama o "Agente Cérebro"
      const aiJson = await aiService.generateResponse(conversation, conversation.lead, conversation.user.settings);
      
      const { 
        reply: aiResponseText, 
        endCall, 
        leadStatus, 
        escalate, 
        proposeScheduling // <-- O Novo Sinal
      } = aiJson;
      
      const lead = conversation.lead;
      const twiml = new VoiceResponse();
      let finalAiResponse = aiResponseText;

      // 2. Decide o que fazer
      if (escalate || endCall) {
        // --- AUTO-TREINAMENTO (Gatilho) ---
        aiService._analyzeConversation(conversation, conversation.lead)
          .then(analysis => {
            if (analysis) aiService._vectorizeAndStore(analysis, conversation._id, lead._id);
          })
          .catch(err => logger.error(`[Auto-Treinamento] Falha ao analisar (thinkAndRespond) ${conversation._id}:`, err));
        // --- FIM ---
        
        if (escalate) {
          conversation.status = 'escalated';
          await this._speakOrFallback(twiml, finalAiResponse || "Estou transferindo para um especialista.");
          twiml.hangup();
        } else { // endCall
          conversation.status = 'closed';
          if (leadStatus && lead) {
            lead.status = leadStatus;
            lead.lastContact = new Date();
            await lead.save();
          }
          await this._speakOrFallback(twiml, finalAiResponse || "Tudo certo, até logo!");
          twiml.hangup();
        }

      // --- LÓGICA DE AGENDAMENTO (NOVO) ---
      } else if (proposeScheduling) {
        logger.info(`[Scheduling] IA solicitou agendamento para ${lead._id}. Buscando horários...`);
        
        // A IA deu a resposta de transição (ex: "Claro, vamos marcar.")
        await this._speakOrFallback(twiml, finalAiResponse); 
        
        // 3. Busca os horários
        const availableSlots = await aiService.getAvailableSlots(conversation.user);
        const schedulingProposalText = await aiService.generateSchedulingProposal(conversation, lead, conversation.user.settings, availableSlots);

        // 4. Fala a proposta de horários
        await this._speakOrFallback(twiml, schedulingProposalText);

        // Salva o status de agendamento na conversa
        conversation.schedulingAttempt = {
          status: 'proposed',
          proposedTimes: availableSlots,
        };
        lead.status = 'morno'; // Ou 'qualificado', dependendo da sua regra
        await lead.save();

        // 5. Ouve a resposta do lead (para os horários)
        const actionUrl = `${process.env.PUBLIC_URL}/api/voice-agent/handle-recording?conversationId=${conversationId}`;
        twiml.record({ action: actionUrl, method: 'POST', maxLength: RECORD_MAX_LENGTH, playBeep: false, timeout: RECORD_TIMEOUT });
        twiml.redirect({ method: 'POST' }, actionUrl);
      
      // --- FIM DA LÓGICA DE AGENDAMENTO ---

      } else {
        // Fluxo normal: Fala a resposta e ouve de novo
        await this._speakOrFallback(twiml, finalAiResponse);
        
        const actionUrl = `${process.env.PUBLIC_URL}/api/voice-agent/handle-recording?conversationId=${conversationId}`;
        twiml.record({ action: actionUrl, method: 'POST', maxLength: RECORD_MAX_LENGTH, playBeep: false, timeout: RECORD_TIMEOUT });
        twiml.redirect({ method: 'POST' }, actionUrl);
      }

      // Salva a resposta da IA na conversa
      if (finalAiResponse) {
          conversation.messages.push({ role: 'ai', content: finalAiResponse, channel: 'voice' });
      }
      await conversation.save();

      res.type('text/xml');
      res.send(twiml.toString());
    } catch (error) {
      logger.error('Erro em thinkAndRespond:', error);
      const twimlError = new VoiceResponse();
      twimlError.say("Desculpe, ocorreu um erro ao processar sua resposta. Poderia repetir?");
      const actionUrl = `${process.env.PUBLIC_URL}/api/voice-agent/handle-recording?conversationId=${conversationId}`;
      twimlError.redirect({ method: 'GET' }, actionUrl); // GET para /twiml era o original, mas POST para /handle-recording é o novo padrão
      res.type('text/xml');
      res.status(500).send(twimlError.toString());
    }
  }

}

module.exports = new VoiceAgentController();