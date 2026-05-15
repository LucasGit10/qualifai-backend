const axios = require('axios');
const logger = require('../../utils/logger');

const GEMINI_API_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_TEXT_MODEL = 'gemini-1.5-flash';
const DEFAULT_TTS_MODEL = 'gemini-1.5-flash-8b';

const getApiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
const getTextModel = () => process.env.GEMINI_MODEL || DEFAULT_TEXT_MODEL;
const getTtsModel = () => process.env.GEMINI_TTS_MODEL || DEFAULT_TTS_MODEL;

function assertConfigured() {
  if (!getApiKey()) {
    logger.error('GEMINI_API_KEY environment variable not set.');
    throw new Error('GEMINI_API_KEY is not configured');
  }
}

function normalizeRole(role) {
  if (role === 'assistant' || role === 'model' || role === 'ai') return 'model';
  return 'user';
}

function chatMessagesToGemini(messages = []) {
  const systemParts = [];
  const contents = [];

  messages.forEach((message) => {
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content || '');

    if (message.role === 'system') {
      systemParts.push({ text: content });
      return;
    }

    contents.push({
      role: normalizeRole(message.role),
      parts: [{ text: content }],
    });
  });

  return {
    systemInstruction: systemParts.length ? { parts: systemParts } : undefined,
    contents: contents.length ? contents : [{ role: 'user', parts: [{ text: '' }] }],
  };
}

function getGenerationConfig(options = {}) {
  const generationConfig = {};

  if (typeof options.temperature === 'number') {
    generationConfig.temperature = options.temperature;
  }
  if (typeof options.max_tokens === 'number') {
    generationConfig.maxOutputTokens = options.max_tokens;
  }
  if (typeof options.maxOutputTokens === 'number') {
    generationConfig.maxOutputTokens = options.maxOutputTokens;
  }
  if (options.response_format?.type === 'json_object' || options.responseMimeType === 'application/json') {
    generationConfig.responseMimeType = 'application/json';
  }
  if (options.responseSchema) {
    generationConfig.responseSchema = options.responseSchema;
  }
  if (options.responseModalities) {
    generationConfig.responseModalities = options.responseModalities;
  }
  if (options.speechConfig) {
    generationConfig.speechConfig = options.speechConfig;
  }

  return Object.keys(generationConfig).length ? generationConfig : undefined;
}

async function generateContent(payload, { model = getTextModel(), timeout = 60000 } = {}) {
  assertConfigured();
  const url = `${GEMINI_API_BASE_URL}/models/${model}:generateContent`;

  const response = await axios.post(url, payload, {
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': getApiKey(),
    },
    timeout,
  });

  return response.data;
}

function extractText(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.map(part => part.text || '').join('').trim();
}

function extractInlineData(response) {
  const parts = response?.candidates?.[0]?.content?.parts || [];
  return parts.find(part => part.inlineData || part.inline_data)?.inlineData
    || parts.find(part => part.inlineData || part.inline_data)?.inline_data
    || null;
}

async function chatCompletion(messages, options = {}) {
  const { systemInstruction, contents } = chatMessagesToGemini(messages);
  const generationConfig = getGenerationConfig(options);
  const payload = {
    contents,
    ...(systemInstruction ? { systemInstruction } : {}),
    ...(generationConfig ? { generationConfig } : {}),
  };

  const response = await generateContent(payload, {
    model: options.model || getTextModel(),
    timeout: options.timeout || 60000,
  });

  const text = extractText(response);
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }
  return text;
}

async function transcribeAudio(audioBuffer, mimeType = 'audio/ogg') {
  const payload = {
    contents: [{
      role: 'user',
      parts: [
        {
          text: 'Transcreva este audio em portugues do Brasil. Responda apenas com a transcricao, sem comentarios.',
        },
        {
          inlineData: {
            mimeType,
            data: audioBuffer.toString('base64'),
          },
        },
      ],
    }],
    generationConfig: {
      temperature: 0,
    },
  };

  const response = await generateContent(payload, {
    model: process.env.GEMINI_AUDIO_MODEL || getTextModel(),
    timeout: 120000,
  });

  return extractText(response);
}

async function textToSpeechPcm(text, voiceName = 'Kore') {
  const payload = {
    contents: [{ role: 'user', parts: [{ text }] }],
    generationConfig: {
      responseModalities: ['AUDIO'],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName,
          },
        },
      },
    },
  };

  const response = await generateContent(payload, {
    model: getTtsModel(),
    timeout: 120000,
  });

  const inlineData = extractInlineData(response);
  if (!inlineData?.data) {
    throw new Error('Gemini returned no audio data');
  }

  return {
    buffer: Buffer.from(inlineData.data, 'base64'),
    mimeType: inlineData.mimeType || inlineData.mime_type || 'audio/L16;codec=pcm;rate=24000',
  };
}

module.exports = {
  chatCompletion,
  generateContent,
  getTextModel,
  textToSpeechPcm,
  transcribeAudio,
};
