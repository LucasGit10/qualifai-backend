/**
 * AppError — Erro de Regra de Negócio
 *
 * Use para representar violações de regra de negócio, pré-condições não satisfeitas,
 * recursos não encontrados, configurações ausentes, etc.
 *
 * Esses erros são **operacionais** (esperados), não bugs. Por isso:
 *   - Sempre expõem a mensagem real ao cliente (mesmo em produção)
 *   - NÃO geram stack trace nos logs (são esperados, não surpreendentes)
 *   - Retornam o statusCode HTTP correto automaticamente
 *
 * Códigos HTTP recomendados:
 *   400 — Bad Request     : input inválido, campo faltando
 *   401 — Unauthorized    : token inválido ou ausente
 *   403 — Forbidden       : sem permissão para a operação
 *   404 — Not Found       : recurso não existe
 *   409 — Conflict        : estado conflitante (ex: email já existe)
 *   422 — Unprocessable   : regra de negócio violada (ex: lead sem telefone)
 *   502 — Bad Gateway     : falha em API externa (Meta, Stripe, etc.)
 *   503 — Service Unavail : dependência não configurada (instância WA desconectada, etc.)
 *
 * @example
 *   throw new AppError('Lead sem número de telefone cadastrado.', 422);
 *   throw new AppError('Token de acesso Meta inválido ou expirado.', 401);
 *   throw new AppError('Instância do WhatsApp não associada a esta conversa.', 422);
 */
class AppError extends Error {
  /**
   * @param {string} message   - Mensagem legível pelo usuário final
   * @param {number} statusCode - HTTP status code (padrão: 422)
   * @param {string} [code]     - Slug de identificação do erro (ex: 'LEAD_NO_PHONE')
   */
  constructor(message, statusCode = 422, code = null) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true; // marca como erro esperado, não bug

    // Preserva stack trace nativo sem poluir com AppError() em si
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, AppError);
    }
  }
}

module.exports = AppError;
