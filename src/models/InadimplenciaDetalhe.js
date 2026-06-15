const mongoose = require('mongoose');

/**
 * InadimplenciaDetalhe — Layout Inadimplência Detalhado (INADIMPLENCIA DETALHADO e Plan1)
 * Registro focado no atraso e detalhe da cobrança, com dados do devedor.
 */
const inadimplenciaDetalheSchema = new mongoose.Schema({
  // ── Referências ──────────────────────────────────────────────────────────
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  importBatch: { type: String, trim: true },   // ex: "2025-04_inadimplencia.xlsx"
  arquivoOrigem: { type: String, trim: true }, // "INADIMPLENCIA_DETALHADO" | "PLAN1"
  debtorImportKey: { type: String, trim: true },
  chargeImportKey: { type: String, trim: true },
  firstSeenBatch: { type: String, trim: true },
  lastSeenBatch: { type: String, trim: true },
  exitedInBatch: { type: String, trim: true },
  importStatus: {
    type: String,
    enum: ['novo', 'mantido', 'saiu'],
    default: 'novo'
  },

  // ── Texto (String) ────────────────────────────────────────────────────────
  cliente:             { type: String, trim: true },
  torre:               { type: String, trim: true },
  apto:                { type: String, trim: true },
  esp:                 { type: String, trim: true },
  taxaExtra:           { type: String, trim: true },
  elemento:            { type: String, trim: true },
  empreendimento:      { type: String, trim: true },
  enderecoResidencial: { type: String, trim: true },
  enderecoComercial:   { type: String, trim: true },
  profissao:           { type: String, trim: true },
  agenteCobranca:      { type: String, trim: true },

  // ── Texto Formatado (identificadores) ────────────────────────────────────
  contrato:  { type: String, trim: true }, // Ex: "0018-4"
  cpfCnpj:   { type: String, trim: true }, // Ex: "772.580.451-04"
  rg:        { type: String, trim: true },
  telefone1: { type: String, trim: true },
  telefone2: { type: String, trim: true },

  // ── Inteiro ───────────────────────────────────────────────────────────────
  parcela: { type: Number },
  atraso:  { type: Number }, // Dias em atraso

  // ── Datas ─────────────────────────────────────────────────────────────────
  vencimento:     { type: Date }, // Chave de separação mensal
  dataNascimento: { type: Date },

  // ── Caráter ───────────────────────────────────────────────────────────────
  rf: { type: String, trim: true, maxlength: 1 }, // "R" ou "F"

  // ── Numérico Decimal ──────────────────────────────────────────────────────
  principal: { type: Number, default: 0 },
  juros:     { type: Number, default: 0 }, // Juros de Mora
  encargos:  { type: Number, default: 0 },
  multa:     { type: Number, default: 0 },
  seguro:    { type: Number, default: 0 },
  total:     { type: Number, default: 0 }, // Total da dívida conforme planilha

  // ── Controle de Pagamento ────────────────────────────────────────────────
  paidAmount:    { type: Number, default: 0 },
  paidAt:        { type: Date },
  paymentMethod: { type: String, enum: ['pix', 'boleto', 'cash', 'card', 'transfer'] },
  status: { 
    type: String, 
    enum: ['pendente', 'pago', 'atrasado', 'negociado', 'cancelado'], 
    default: 'pendente' 
  },
  tags: [String],

}, { timestamps: true });

// Índices para consulta e agrupamento mensal
inadimplenciaDetalheSchema.index({ user: 1, vencimento: 1 });
inadimplenciaDetalheSchema.index({ user: 1, cpfCnpj: 1 });
inadimplenciaDetalheSchema.index({ user: 1, contrato: 1 });
inadimplenciaDetalheSchema.index({ user: 1, atraso: 1 });
inadimplenciaDetalheSchema.index({ user: 1, empreendimento: 1 });
inadimplenciaDetalheSchema.index({ importBatch: 1 });
inadimplenciaDetalheSchema.index({ user: 1, debtorImportKey: 1 });
inadimplenciaDetalheSchema.index({ user: 1, chargeImportKey: 1 }, { unique: true, sparse: true });
inadimplenciaDetalheSchema.index({ user: 1, importStatus: 1 });

module.exports = mongoose.model('InadimplenciaDetalhe', inadimplenciaDetalheSchema);
