const AIService = require('../../services/aiService'); // Este é o seu 'index.js' agregador
const crypto = require('crypto');

// --- CORREÇÃO: Importar o arquivo de configuração do prompt ---
// Ajuste o caminho se o nome ou local do seu arquivo de prompt (aiConfig) for diferente.
const landingPageConfig = require('../../config/aiConfigs/promptConfig'); 

/**
 * Função de validação (do seu código original)
 */
function validateConversation(conversation) {
  if (!conversation || !Array.isArray(conversation) || conversation.length === 0) {
    return 'O campo "conversation" deve ser um array não vazio.';
  }
  for (const message of conversation) {
    if (typeof message !== 'object' || message === null || !message.role || !message.content) {
      return 'Cada item da conversa deve ser um objeto com "role" e "content".';
    }
    if (typeof message.role !== 'string' || typeof message.content !== 'string') {
      return 'Os campos "role" e "content" devem ser strings.';
    }
  }
  return null; // Sem erros
}

/**
 * Lida com as requisições de chat da landing page
 */
async function handleLandingAIChat(req, res) {
  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] -- INÍCIO -- Requisição de CHAT para /landing-ai`);
  
  try {
    const { conversation } = req.body;

    const validationError = validateConversation(conversation);
    if (validationError) {
      console.warn(`[${requestId}] ERRO DE VALIDAÇÃO: ${validationError}`);
      return res.status(400).json({ error: validationError });
    }

    // --- CORREÇÃO APLICADA ---
    // 1. Pegar o prompt do arquivo de configuração importado
    const customPrompt = landingPageConfig.aiConfig.prompt;

    if (!customPrompt) {
      // Garantia de que o prompt foi carregado
      throw new Error("Prompt da landing page (aiConfig.prompt) não foi encontrado ou está nulo.");
    }

    // 2. Passar o 'customPrompt' como o segundo argumento para o serviço
    const rawReply = await AIService.generateLandingPageResponse(conversation, customPrompt);
    // --- FIM DA CORREÇÃO ---

    // Lógica de insight (esta parte já estava correta)
    let reply = rawReply;
    let showButton = false;
    const intentToken = "[INTENT:SCHEDULE]";
    const continueToken = "[INTENT:CONTINUE]";

    if (rawReply.includes(intentToken)) {
      console.log(`[${requestId}] INFO: Insight detectado -> INTENT:SCHEDULE`);
      showButton = true;
      reply = rawReply.replace(intentToken, "").trim();
    } else {
      reply = rawReply.replace(continueToken, "").trim();
    }

    console.log(`[${requestId}] INFO: Resposta da IA enviada com sucesso.`);
    
    // Envia o JSON limpo para o frontend
    res.json({ reply, showButton });

  } catch (err) {
    console.error(`[${requestId}] -- ERRO CRÍTICO -- Falha no controller:`, err.message);
    res.status(500).json({ error: 'Ocorreu um erro interno.' });
  } finally {
    console.log(`[${requestId}] -- FIM -- Requisição de CHAT`);
  }
}

/**
 * Lida com as requisições de áudio (Text-to-Speech)
 */
async function handleLandingAISpeech(req, res) {
  const requestId = crypto.randomUUID();
  console.log(`[${requestId}] -- INÍCIO -- Requisição de ÁUDIO para /landing-ai/speak`);

  try {
    const { text } = req.body;
    if (!text) {
      return res.status(400).json({ error: 'O texto é obrigatório para gerar o áudio.' });
    }

    // Correção de pronúncia
    const correctedText = text.replace(/Qualifai/gi, 'Kualifái');

    if (text !== correctedText) {
       console.log(`[${requestId}] INFO: Pronúncia corrigida: "Qualifai" -> "Kualifái"`);
    }

    // Esta chamada funciona se o seu 'aiService' for o 'index.js' (Arquivo 4)
    // que exporta a função 'textToSpeech' do 'aiAudioService'
    const audioBuffer = await AIService.textToSpeech(correctedText, 'nova');

    res.setHeader('Content-Type', 'audio/ogg');
    res.send(audioBuffer);

    console.log(`[${requestId}] INFO: Áudio enviado com sucesso.`);

  } catch (error) {
    console.error(`[${requestId}] -- ERRO CRÍTICO -- Falha no controller handleLandingAISpeech:`, error);
    res.status(500).json({ error: 'Ocorreu um erro ao gerar o áudio.' });
  } finally {
    console.log(`[${requestId}] -- FIM -- Requisição de ÁUDIO`);
  }
}

module.exports = {
  handleLandingAIChat,
  handleLandingAISpeech
};