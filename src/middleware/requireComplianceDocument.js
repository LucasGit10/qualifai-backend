const { hasActiveComplianceDocument } = require('../services/complianceService');

const REQUIRED_MESSAGE = 'Antes de iniciar ou enviar mensagens, anexe o documento que comprova permissao/base legal para uso dos dados e envio de mensagens.';

const requiresOutboundCompliance = (req) => {
  const channel = req.body?.channel || req.body?.conversationChannel;
  if (!channel) return true;
  return ['whatsapp', 'email', 'linkedin', 'voice', 'chat'].includes(channel);
};

const requireComplianceDocument = async (req, res, next) => {
  // Compliance document requirement temporarily disabled — always allow.
  return next();

  // try {
  //   if (!requiresOutboundCompliance(req)) return next();
  //   if (await hasActiveComplianceDocument(req.user)) return next();
  //   return res.status(403).json({
  //     code: 'COMPLIANCE_DOCUMENT_REQUIRED',
  //     message: REQUIRED_MESSAGE,
  //     requiresComplianceDocument: true
  //   });
  // } catch (error) {
  //   return next(error);
  // }
};

module.exports = requireComplianceDocument;