const mongoose = require('mongoose');

/**
 * ContasReceber — Layout Contas a Receber (MARCA REGISTRADA e GRAN TORO)
 * Armazena os detalhes das parcelas e valores a receber de cada empreendimento.
 */
const contasReceberSchema = new mongoose.Schema({
  // ── Referências ──────────────────────────────────────────────────────────
  lead: { type: mongoose.Schema.Types.ObjectId, ref: 'Lead' },
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  importBatch: { type: String, trim: true },   // ex: "2025-04_marca_registrada.xlsx"
  arquivoOrigem: { type: String, trim: true }, // "MARCA_REGISTRADA" | "GRAN_TORO"

  // ── Texto (String) ────────────────────────────────────────────────────────
  empreendimento: { type: String, trim: true },
  edificacao:     { type: String, trim: true },
  cliente:        { type: String, trim: true },
  espCon:         { type: String, trim: true }, // Esp Con.
  esp:            { type: String, trim: true },
  ele:            { type: String, trim: true },
  agente:         { type: String, trim: true },
  cart:           { type: String, trim: true },
  disp:           { type: String, trim: true },
  notif:          { type: String, trim: true },

  // ── Inteiro / Numérico ────────────────────────────────────────────────────
  mes:     { type: Number, min: 1, max: 12 }, // Campo MÊS explícito da planilha
  ano:     { type: Number },                   // Campo ANO explícito da planilha
  parcela: { type: Number },                   // Ex: 1, 2, 3...

  // ── Datas ─────────────────────────────────────────────────────────────────
  vencimento: { type: Date }, // Chave de separação mensal
  emissao:    { type: Date },

  // ── Texto Formatado ───────────────────────────────────────────────────────
  contrato: { type: String, trim: true }, // Ex: "0018-4"

  // ── Numérico Decimal ──────────────────────────────────────────────────────
  valorAtualizado: { type: Number, default: 0 },
  principal:       { type: Number, default: 0 },
  jurosContrato:   { type: Number, default: 0 },
  reajuste:        { type: Number, default: 0 },
  encargos:        { type: Number, default: 0 },
  juros:           { type: Number, default: 0 },
  multa:           { type: Number, default: 0 },
  seguros:         { type: Number, default: 0 },

  // ── Campo derivado (calculado) ────────────────────────────────────────────
  totalDevido: {
    type: Number,
    default: function () {
      return (this.principal || 0) + (this.juros || 0) + (this.multa || 0)
        + (this.encargos || 0) + (this.seguros || 0) + (this.reajuste || 0);
    }
  },

}, { timestamps: true });

// Índices para consulta e agrupamento mensal
contasReceberSchema.index({ user: 1, ano: 1, mes: 1 });
contasReceberSchema.index({ user: 1, vencimento: 1 });
contasReceberSchema.index({ user: 1, contrato: 1 });
contasReceberSchema.index({ user: 1, empreendimento: 1 });
contasReceberSchema.index({ importBatch: 1 });

module.exports = mongoose.model('ContasReceber', contasReceberSchema);
