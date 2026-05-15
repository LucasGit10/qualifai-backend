// Este serviço orquestra a conversa de voz em tempo real.
// Utiliza vários serviços externos:
// - Twilio: Para a chamada telefônica e streaming de áudio.
// - Deepgram: Para transcrição em tempo real.
// - Gemini: Para respostas de IA conversacional.
// - ElevenLabs: Para text-to-speech realista via WSS.

const { createClient } = require("@deepgram/sdk");
const { chatCompletion } = require('./ai/handlers/chat.handler');
const logger = require('../utils/logger');
const WebSocket = require('ws'); // Para ElevenLabs WSS

// --- CONFIGURAÇÃO ---
const DEEPGRAM_LIVE_CONFIG = {
    model: 'nova-2',
    language: 'pt-BR',
    encoding: 'mulaw',
    sample_rate: 8000,
    punctuate: true,
    interim_results: false,
};

// --- INICIALIZAÇÃO DOS SERVIÇOS ---
let deepgram = null;
if (process.env.DEEPGRAM_API_KEY) {
  deepgram = createClient(process.env.DEEPGRAM_API_KEY);
} else {
  logger.warn('[VoiceAgent] DEEPGRAM_API_KEY não configurada. O serviço de voz em tempo real ficará indisponível.');
}

class VoiceCallHandler {
  constructor(ws, io) {
    this.ws = ws; // WebSocket com o Twilio
    this.io = io; // Socket.io para comunicação com o frontend
    this.deepgramConnection = null;
    this.conversationHistory = [];
    this.isAiSpeaking = false;
    this.isInterrupted = false;
    this.callSid = null; 
    this.streamSid = null; // ESSENCIAL para responder ao Twilio
  }

  // Ponto de entrada principal para uma nova conexão
  async handleConnection() {
    this.setupWebSocketListeners();
    this.setupGemini();
  }

  // ==========================================================
  // --- ATUALIZADO (1/2): HABILITADO PARA TWILIO JSON ---
  // ==========================================================
  setupWebSocketListeners() {
    this.ws.on('message', (message) => {
        // O Twilio Media Streams SEMPRE envia JSON.
        try {
            const msg = JSON.parse(message);

            // --- LÓGICA DO TWILIO (Baseada em eventos JSON) ---
            switch (msg.event) {
                case 'connected':
                    logger.info('Twilio media stream connected.');
                    break;
                case 'start':
                    this.callSid = msg.start.callSid;
                    this.streamSid = msg.start.streamSid; // <-- Seta o streamSid
                    logger.info(`Call started: ${this.callSid}. Stream: ${this.streamSid}`);
                    
                    this.setupDeepgramStream();
                    this.emitToFrontend('call-status', `Chamada em andamento para ${msg.start.to || ''}`);
                    
                    // Pega a mensagem inicial do TwiML (se houver)
                    // NOTA: A mensagem inicial agora é dita pelo TwiML <Say> (no controller)
                    // Se quiser que a IA diga, você precisa buscar a conversa aqui
                    // e chamar this.processAiResponse(initialMessage);
                    
                    break;
                case 'media':
                    // Recebe áudio do Twilio (base64) e envia para Deepgram (bruto)
                    if (this.deepgramConnection && this.deepgramConnection.getReadyState() === 1) { // OPEN
                        this.deepgramConnection.send(Buffer.from(msg.media.payload, 'base64'));
                    }
                    // Se o usuário falar, interrompe a IA
                    if (this.isAiSpeaking) {
                        this.isInterrupted = true; 
                    }
                    break;
                case 'stop':
                    logger.info(`Call stopped: ${this.callSid}`);
                    this.emitToFrontend('call-status', 'Chamada encerrada');
                    this.cleanup();
                    break;
                default:
                    break;
            }
            // --- FIM DA LÓGICA DO TWILIO ---

        } catch (error) {
            // Se o JSON.parse falhar, é um erro. O modo Vonage (áudio bruto) não é mais suportado
            logger.error('Erro ao processar mensagem do WebSocket (esperava JSON do Twilio):', error);
        }
    });

    this.ws.on('close', () => {
        logger.info(`WebSocket connection closed for call ${this.callSid}.`);
        this.cleanup();
    });
  }

  setupDeepgramStream() {
    this.deepgramConnection = deepgram.listen.live(DEEPGRAM_LIVE_CONFIG);

    this.deepgramConnection.on('open', () => logger.info('Deepgram connection opened.'));
    this.deepgramConnection.on('error', (error) => logger.error('Deepgram Error:', error));
    this.deepgramConnection.on('close', () => logger.info('Deepgram connection closed.'));

    this.deepgramConnection.on('transcript', (data) => {
        const transcript = data.channel.alternatives[0].transcript;
        if (transcript && data.is_final) {
            logger.info(`User said: ${transcript}`);
            this.emitToFrontend('transcript-update', { speaker: 'user', text: transcript });
            this.processUserUtterance(transcript);
        }
    });
  }

  setupGemini() {
    const systemPrompt = "Você é um agente de atendimento por telefone amigável e profissional da QualifAI. Seja conciso e natural. Seu objetivo é qualificar o lead e agendar uma demonstração.";
    this.conversationHistory = [{ role: 'system', content: systemPrompt }];
  }

  async processUserUtterance(text) {
    if (this.isAiSpeaking) return;

    this.conversationHistory.push({ role: 'user', content: text });

    try {
      const aiResponseText = await chatCompletion(this.conversationHistory, {
        max_tokens: 180,
        temperature: 0.7,
      });
      
      if (aiResponseText) {
          this.conversationHistory.push({ role: 'assistant', content: aiResponseText });
          this.processAiResponse(aiResponseText);
      }
    } catch (error) {
      logger.error('Gemini API Error:', error);
    }
  }
  
  // (Função mantida como na última versão - WSS ElevenLabs)
  async processAiResponse(text) {
    logger.info(`AI says: ${text}`);
    this.emitToFrontend('transcript-update', { speaker: 'ai', text });
    this.isAiSpeaking = true;
    this.isInterrupted = false;

    // Constrói a URL do WebSocket da ElevenLabs
    const ELEVENLABS_VOICE_ID = process.env.ELEVENLABS_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
    const MODEL_ID = "eleven_multilingual_v2";
    const WSS_URL = `wss://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}/stream-input?model_id=${MODEL_ID}`;

    const ttsSocket = new WebSocket(WSS_URL);
    let audioStreamStarted = false;

    ttsSocket.onopen = () => {
      logger.info('[ElevenLabs WSS] Conexão aberta.');
      
      try {
        ttsSocket.send(JSON.stringify({ xi_api_key: process.env.ELEVENLABS_API_KEY }));
        ttsSocket.send(JSON.stringify({
          voice_settings: { stability: 0.5, similarity_boost: 0.75 }
        }));
        ttsSocket.send(JSON.stringify({
          output_format: "ulaw_8000" // Formato de telefonia
        }));
        ttsSocket.send(JSON.stringify({ text: text }));
        ttsSocket.send(JSON.stringify({ text: "" })); // Fim do stream

      } catch (error) {
        logger.error('[ElevenLabs WSS] Erro ao enviar dados no onopen:', error);
        ttsSocket.close();
      }
    };

    ttsSocket.onmessage = (event) => {
      if (this.isInterrupted) {
        logger.info('[ElevenLabs WSS] Interrupção detectada, fechando socket.');
        ttsSocket.close();
        return;
      }
      try {
        const data = JSON.parse(event.data);
        if (data.audio) {
          if (!audioStreamStarted) {
            logger.info('[ElevenLabs WSS] Primeiro chunk de áudio (ulaw) recebido.');
            audioStreamStarted = true;
          }
          // Decodifica o áudio (que já está em ulaw_8000)
          const audioChunk = Buffer.from(data.audio, 'base64');
          // Envia o chunk ulaw para a função de resposta
          this.sendAudioToCall(audioChunk); 
        }
      } catch (error) {
        logger.error('[ElevenLabs WSS] Erro ao processar mensagem:', error);
      }
    };

    ttsSocket.onclose = (event) => {
      logger.info(`[ElevenLabs WSS] Socket fechado. Code: ${event.code}`);
      this.isAiSpeaking = false;
      this.isInterrupted = false;
    };

    ttsSocket.onerror = (error) => {
      logger.error(`[ElevenLabs WSS] Erro de WebSocket: ${error.message}`);
      this.isAiSpeaking = false;
      this.isInterrupted = false;
    };
  }

  // ==========================================================
  // --- ATUALIZADO (2/2): FORMATO DE ENVIO CORRETO PARA TWILIO ---
  // ==========================================================
  sendAudioToCall(audioChunk) {
    // (audioChunk é um Buffer de áudio ulaw)

    // Se não tivermos o streamSid (chamada ainda não começou) ou o WS fechou, não faça nada.
    if (!this.streamSid || this.ws.readyState !== this.ws.OPEN) {
      return;
    }

    // --- LÓGICA DO TWILIO (HABILITADA) ---
    // Converte o áudio ulaw BRUTO para base64
    const payloadBase64 = audioChunk.toString('base64');

    // Monta o pacote JSON que o Twilio Media Streams espera
    const mediaMessage = {
      event: 'media',
      streamSid: this.streamSid,
      media: {
        payload: payloadBase64,
      },
    };
    
    // Envia a string JSON
    this.ws.send(JSON.stringify(mediaMessage));
    
    // --- FIM DA LÓGICA DO TWILIO ---

    // +++ LÓGICA DA VONAGE (DESABILITADA) +++
    // (A Vonage esperava o buffer de áudio bruto (ulaw))
    // if (this.ws.readyState === this.ws.OPEN) {
    //     this.ws.send(audioChunk); 
    // }
    // +++ FIM DA LÓGICA DA VONAGE +++
  }

  emitToFrontend(event, data) {
    if (this.io) {
        this.io.emit(event, data);
    }
  }

  cleanup() {
    if (this.deepgramConnection) {
        this.deepgramConnection.finish();
        this.deepgramConnection = null;
    }
  }
}

// Exporta a função handler que será chamada pelo server.js para cada nova conexão WebSocket.
module.exports = (ws, io) => {
  const handler = new VoiceCallHandler(ws, io);
  handler.handleConnection();
};
