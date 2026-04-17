const express = require('express');
const router = express.Router();
const debtController = require('../../controllers/collections/debt.controller');
const auth = require('../../middleware/auth');

const multer = require('multer');
const upload = multer({ dest: 'uploads/' });

router.post('/', auth, debtController.createDebt);
router.get('/annual-summary', auth, debtController.getAnnualSummary);
router.get('/:id', auth, debtController.getDebtDetails);
router.get('/lead/:leadId', auth, debtController.getDebtByLead);
router.post('/payment', auth, debtController.processPayment);
router.post('/lead/:leadId/pay-all', auth, debtController.payAll);
router.post('/guarantor', auth, debtController.addGuarantor);
router.post('/import', auth, upload.single('file'), debtController.uploadDebts);

module.exports = router;
