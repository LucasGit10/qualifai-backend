const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const auth = require('../../middleware/auth');
const complianceController = require('../../controllers/platform/compliance.controller');

const router = express.Router();

const uploadDir = path.join(__dirname, '../../../storage/compliance-documents');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    cb(null, `${req.user.id}-${Date.now()}${ext}`);
  }
});

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (allowedMimeTypes.has(file.mimetype)) return cb(null, true);
    cb(new Error('Formato invalido. Envie PDF, imagem, DOC ou DOCX.'));
  }
});

router.get('/status', auth, complianceController.getStatus);
router.post('/document', auth, upload.single('document'), complianceController.uploadDocument);
router.get('/document/download', auth, complianceController.downloadDocument);

module.exports = router;
