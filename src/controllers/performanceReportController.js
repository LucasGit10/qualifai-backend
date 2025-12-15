
const performanceReportService = require('../services/performanceReportService');
const logger = require('../utils/logger');

class PerformanceReportController {
    async triggerManualReport(req, res) {
        try {
            const userId = req.user.id;
            logger.info(`[PerformanceReportController] Manual report triggered for user ${userId}.`);
            await performanceReportService.generateAndSendManualReport(userId);
            res.json({ success: true, message: 'Relatório manual gerado e enviado com sucesso!' });
        } catch (error) {
            logger.error(`[PerformanceReportController] Error triggering manual report for user ${req.user.id}:`, error);
            res.status(500).json({ message: error.message || 'Erro interno ao gerar relatório.' });
        }
    }
}

module.exports = new PerformanceReportController();
