const express = require('express');
const router = express.Router();
const spreadsheetController = require('../../controllers/collections/spreadsheet.controller');
const auth = require('../../middleware/auth');
const multer = require('multer');
const path = require('path');
const chunkedUpload = require('../../utils/chunkedUpload');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, 'uploads/'),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${file.originalname.replace(/\s/g, '_')}`);
  },
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) return cb(null, true);
    cb(new Error(`Formato não suportado: ${ext}. Use CSV ou Excel.`));
  },
  limits: { fileSize: 100 * 1024 * 1024 }
});
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 }
});

router.post('/import/upload/start', auth, (req, res) => {
  try {
    const { originalName, totalSize, totalChunks } = req.body;
    const extension = path.extname(String(originalName || '')).toLowerCase();
    if (!['.csv', '.xlsx', '.xls'].includes(extension)) {
      return res.status(400).json({ message: 'Formato não suportado. Use CSV ou Excel.' });
    }
    if (!Number.isInteger(Number(totalChunks)) || Number(totalChunks) < 1 || Number(totalChunks) > 1000) {
      return res.status(400).json({ message: 'Quantidade de partes invalida.' });
    }
    if (!Number.isFinite(Number(totalSize)) || Number(totalSize) > 100 * 1024 * 1024) {
      return res.status(400).json({ message: 'O arquivo deve ter no maximo 100 MB.' });
    }
    const uploadId = chunkedUpload.startUpload({
      userId: req.user.id,
      originalName,
      totalSize,
      totalChunks
    });
    return res.status(201).json({ uploadId });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/import/upload/chunk', auth, chunkUpload.single('chunk'), (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Parte do arquivo obrigatoria.' });
    const metadata = chunkedUpload.saveChunk({
      uploadId: req.body.uploadId,
      userId: req.user.id,
      chunkIndex: req.body.chunkIndex,
      buffer: req.file.buffer
    });
    return res.json({ received: metadata.receivedChunks.length, total: metadata.totalChunks });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

router.post('/import/upload/complete', auth, (req, res) => {
  try {
    const result = chunkedUpload.completeUpload({ uploadId: req.body.uploadId, userId: req.user.id });
    return res.json({ uploadId: req.body.uploadId, originalName: result.originalName });
  } catch (error) {
    return res.status(400).json({ message: error.message });
  }
});

// ── Importação Unificada Genérica (UPSERT) ──────────────────────────────────
router.post('/import/preview', auth, upload.single('file'), spreadsheetController.previewGenericImport);
router.post('/import/generic', auth, upload.single('file'), spreadsheetController.importGeneric);

// ── Semestre / Batches ──────────────────────────────────────────────────────────
router.get('/debtors', auth, spreadsheetController.getDebtorsSummary);
router.get('/totals', auth, spreadsheetController.getCarteiraTotals);

router.get('/export/debtors', auth, spreadsheetController.exportDebtorsReport);
router.get('/by-month', auth, spreadsheetController.getByMonth);
router.get('/import-batches', auth, spreadsheetController.getImportBatches);
router.post('/debtors/manual', auth, spreadsheetController.createManualDebtor);
router.post('/debtors/:leadId/next-action', auth, spreadsheetController.scheduleDebtorNextAction);
router.delete('/debtors/:leadId/next-action', auth, spreadsheetController.cancelDebtorNextAction);
router.put('/debtors/:leadId/status', auth, spreadsheetController.updateDebtorStatus);
router.put('/debtors/:leadId/report-status', auth, spreadsheetController.updateDebtorReportStatus);
router.post('/debtors/:leadId/notes', auth, spreadsheetController.addDebtorNote);
router.delete('/debtors/:leadId/notes/:noteId', auth, spreadsheetController.deleteDebtorNote);
router.delete('/clear', auth, spreadsheetController.clearData);

// ── Diagnóstico e Correção de Duplicatas ────────────────────────────────────
router.get('/diagnose-duplicates', auth, spreadsheetController.diagnoseDuplicates);
router.post('/fix-duplicates', auth, spreadsheetController.fixDuplicates);
router.post('/fix-null-leads', auth, spreadsheetController.fixNullLeads);

module.exports = router;
