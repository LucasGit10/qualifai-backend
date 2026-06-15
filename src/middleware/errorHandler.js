const logger = require('../utils/logger');
const AppError = require('../utils/AppError');

const errorHandler = (err, req, res, next) => {
  // ── Erro de Regra de Negócio (AppError) ──────────────────────────────────
  if (err instanceof AppError || err.isOperational) {
    logger.warn(`[Negócio] ${req.method} ${req.originalUrl}: ${err.message}`, {
      code: err.code,
      statusCode: err.statusCode,
    });

    return res.status(err.statusCode || 422).json({
      message: err.message,
      code: err.code || undefined,
    });
  }

  // ── Erros do Mongoose ─────────────────────────────────────────────────────
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ message: 'Erro de validação', errors });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: `ID inválido: ${err.value}` });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0] || 'campo';
    return res.status(409).json({ message: `Recurso já existe (campo duplicado: ${field})` });
  }

  // ── Erro Técnico (bug, falha de infra) ───────────────────────────────────
  logger.error('[Técnico] Erro não tratado capturado pelo middleware:', {
    message: err.message,
    stack: err.stack,
    url: req.originalUrl,
    method: req.method,
  });

  const httpStatus = err.statusCode || err.status || 500;
  const isDev = process.env.NODE_ENV !== 'production';

  res.status(httpStatus).json({
    message: isDev
      ? `Erro interno: ${err.message}`
      : 'Erro interno do servidor. Tente novamente ou contate o suporte.',
    ...(isDev && { stack: err.stack }),
  });
};

module.exports = errorHandler;