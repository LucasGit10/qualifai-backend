// routes/aiTraining.js
const express = require('express');
const router = express.Router();
const aiTrainingController = require('../controllers/aiTrainingController');
const auth = require('../middleware/auth'); // Middleware de autenticação
const multer = require('multer'); 
const os = require('os');

// Configuração do Multer (Armazenamento Temporário)
// IMPORTANTE: Use o destino de arquivos temporários do sistema
const upload = multer({ dest: os.tmpdir() }); 

// Prefixo da rota: /api/ai-training

/**
 * 1. Rota para simular uma resposta da IA na página de treinamento.
 * POST /api/ai-training/simulate-response
 */
router.post(
  '/simulate-response',
  auth, 
  aiTrainingController.simulateAIResponse
);

/**
 * 2. Rota para upload de documentos (para RAG).
 * POST /api/ai-training/upload-document
 */
router.post(
  '/upload-document',
  auth,
  // Usa o middleware Multer para aceitar um arquivo (campo 'document')
  upload.single('document'), 
  aiTrainingController.handleDocumentUpload
);

/**
 * 3. Rota para buscar as métricas do gráfico.
 * GET /api/ai-training/metrics
 */
router.get(
  '/metrics',
  auth,
  aiTrainingController.getLearningMetrics
);
router.post(
  '/run-synthetic-training',
  auth, // <-- 2. Proteja este endpoint!
  aiTrainingController.runSyntheticTraining // <-- 3. Adicione a nova rota
);


router.get(
  '/synthetic-conversations',
  auth, // <-- 2. Proteja o endpoint
  aiTrainingController.getSyntheticConversations // <-- 3. Adicione a rota
);


router.delete(
  '/synthetic-conversations/all', // <-- Rota 'all' vem PRIMEIRO
  auth,
  aiTrainingController.deleteAllSyntheticConversations
);

/**
 * @route   DELETE /api/v1/ai-training/synthetic-conversations/:id
 * @desc    Deleta um log de conversa sintética específico
 * @access  Private
 */
router.delete(
  '/synthetic-conversations/:id', // <-- Rota com ':id' vem DEPOIS
  auth,
  aiTrainingController.deleteSingleSyntheticConversation
);

router.get(
  '/synthetic-training/status',
  auth,
  aiTrainingController.getSyntheticTrainingStatus
);
module.exports = router;