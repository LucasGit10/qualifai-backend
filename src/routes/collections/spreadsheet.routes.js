const express = require('express');
const router = express.Router();
const spreadsheetController = require('../../controllers/collections/spreadsheet.controller');
const auth = require('../../middleware/auth');
const multer = require('multer');
const path = require('path');

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
  limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

// ── Importação Unificada Genérica (UPSERT) ──────────────────────────────────
router.post('/import/generic', auth, upload.single('file'), spreadsheetController.importGeneric);

// ── Semestre / Batches ──────────────────────────────────────────────────────────
router.get('/debtors',       auth, spreadsheetController.getDebtorsSummary);
router.get('/export/debtors', auth, spreadsheetController.exportDebtorsReport);
router.get('/by-month',       auth, spreadsheetController.getByMonth);
router.get('/import-batches', auth, spreadsheetController.getImportBatches);
router.put('/debtors/:leadId/report-status', auth, spreadsheetController.updateDebtorReportStatus);
router.delete('/clear',       auth, spreadsheetController.clearData);

// ── Diagnóstico e Correção de Duplicatas ────────────────────────────────────
router.get('/diagnose-duplicates',  auth, spreadsheetController.diagnoseDuplicates);
router.post('/fix-duplicates',      auth, spreadsheetController.fixDuplicates);
router.post('/fix-null-leads',      auth, spreadsheetController.fixNullLeads);

module.exports = router;
