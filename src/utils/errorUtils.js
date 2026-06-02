const logger = require('./logger');
const AppError = require('./AppError');

/**
 * Trata erros de controladores de forma padronizada.
 *
 * Regras:
 *  - AppError (isOperational): sempre mostra a mensagem real (é mensagem de negócio),
 *    NÃO loga stack trace (erro esperado), retorna o statusCode do erro.
 *  - Erros técnicos: em dev expõe mensagem + stack; em prod retorna mensagem genérica;
 *    SEMPRE loga com stack trace via winston.
 *
 * @param {object}  res       - Objeto de resposta do Express
 * @param {Error}   error     - O erro capturado no catch
 * @param {string}  context   - Texto descritivo da operação (ex: 'ao listar conversas')
 * @param {number}  [status]  - Status HTTP override (raramente necessário)
 */
const handleControllerError = (res, error, context = 'na operação', status) => {
  // ── Erro de Regra de Negócio (AppError) ──────────────────────────────────
  if (error instanceof AppError || error.isOperational) {
    // Loga como warn — é esperado, não é bug
    logger.warn(`[Negócio] ${context}: ${error.message}`, {
      code: error.code,
      statusCode: error.statusCode,
    });

    return res.status(error.statusCode || status || 422).json({
      message: error.message,       // sempre expõe: é mensagem de negócio, não técnica
      code: error.code || undefined,
    });
  }

  // ── Erros do Mongoose ─────────────────────────────────────────────────────
  if (error.name === 'ValidationError') {
    const errors = Object.values(error.errors).map(e => e.message);
    return res.status(400).json({ message: 'Erro de validação', errors });
  }

  if (error.name === 'CastError') {
    return res.status(400).json({ message: `ID inválido: ${error.value}` });
  }

  if (error.code === 11000) {
    const field = Object.keys(error.keyValue || {})[0] || 'campo';
    return res.status(409).json({ message: `Recurso já existe (campo duplicado: ${field})` });
  }

  // ── Erro Técnico (bug, falha de infra) ───────────────────────────────────
  const httpStatus = status || error.statusCode || 500;
  logger.error(`[Técnico] Erro ${context}:`, { message: error.message, stack: error.stack });

  const isDev = process.env.NODE_ENV !== 'production';

  return res.status(httpStatus).json({
    message: isDev
      ? `Erro ${context}: ${error.message}`
      : 'Erro interno do servidor. Tente novamente ou contate o suporte.',
    ...(isDev && { stack: error.stack }),
    error: isDev ? error.message : undefined,
  });
};

module.exports = { handleControllerError };
