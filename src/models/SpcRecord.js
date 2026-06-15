const mongoose = require('mongoose');

/**
 * SpcRecord — Layout SPC (Ficheiros SPC MR e SPC GT)
 * Armazena registros de inadimplência do SPC, com dados do cliente e cheques.
 */
const spcRecordSchema = new mongoose.Schema({
  // ── Referências ──────────────────────────────────────────────────────────
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  importBatch: { type: String, trim: true }, // ex: "2025-04_spc_mr.csv"
  arquivoOrigem: { type: String, trim: true }, // "SPC_MR" | "SPC_GT"

  // ── Dados do Cliente (String / Texto) ────────────────────────────────────
  razao:        { type: String, trim: true },
  email:        { type: String, trim: true, lowercase: true },
  logradouro:   { type: String, trim: true },
  complemento:  { type: String, trim: true },
  bairro:       { type: String, trim: true },
  cidade:       { type: String, trim: true },
  uf:           { type: String, trim: true, maxlength: 2 },
  alinea:       { type: String, trim: true },

  // ── Caracteres / Texto Curto ──────────────────────────────────────────────
  tipoDocumento:  { type: String, trim: true }, // Ex: "CPF", "CNPJ"
  tipoComprador:  { type: String, trim: true }, // Ex: "F", "J"
  tipoOperacao:   { type: String, trim: true }, // Ex: "F", "C", "I"

  // ── Texto Formatado ───────────────────────────────────────────────────────
  numeroDocumento: { type: String, trim: true }, // CPF "772.580.451-04" ou CNPJ
  cep:             { type: String, trim: true }, // "38418668"
  contrato:        { type: String, trim: true }, // "0038-3"

  // ── Datas ─────────────────────────────────────────────────────────────────
  dataNascimento:    { type: Date },
  dataCompra:        { type: Date },
  dataVencimento:    { type: Date }, // Usado como chave de separação mensal
  dataEmissaoChq:    { type: Date },

  // ── Numérico Decimal ──────────────────────────────────────────────────────
  valorSpc: { type: Number, default: 0 }, // separador decimal por ponto
  valorChq: { type: Number, default: 0 },

  // ── Inteiro / Texto ───────────────────────────────────────────────────────
  numero:              { type: String, trim: true },
  banco:               { type: String, trim: true },
  agencia:             { type: String, trim: true },
  numeroChqInicial:    { type: String, trim: true },
  numeroChqFinal:      { type: String, trim: true },
  digitoNumeroChq:     { type: String, trim: true },
  codigoAssociado:     { type: String, trim: true },
  codigoErro:          { type: String, trim: true },

}, { timestamps: true });

// Índices para consulta por usuário, mês de vencimento e contrato
spcRecordSchema.index({ user: 1, dataVencimento: 1 });
spcRecordSchema.index({ user: 1, contrato: 1 });
spcRecordSchema.index({ user: 1, numeroDocumento: 1 });
spcRecordSchema.index({ importBatch: 1 });

module.exports = mongoose.model('SpcRecord', spcRecordSchema);
