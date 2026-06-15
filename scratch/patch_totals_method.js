const fs = require('fs');
const path = 'src/controllers/collections/spreadsheet.controller.js';
let content = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// Localiza o ponto de inserção: após o getByMonth e antes do getDebtorsSummary
const MARKER = '  async getDebtorsSummary(req, res) {';
const idx = content.indexOf(MARKER);
if (idx === -1) { console.error('Marker not found!'); process.exit(1); }

const NEW_METHOD = `  // \u2500\u2500 4a2. Totais reais da carteira (sem depender de lead) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  async getCarteiraTotals(req, res) {
    try {
      const userId = req.user.id;
      const uid = new (require('mongoose').Types.ObjectId)(userId);
      const today = new Date();

      const [totais, porStatus, nullLeadInfo] = await Promise.all([
        InadimplenciaDetalhe.aggregate([
          { $match: { user: uid, status: { $ne: 'pago' } } },
          { $group: {
            _id: null,
            somaTotal:     { $sum: '$total' },
            somaPrincipal: { $sum: '$principal' },
            somaVencido:   { $sum: { $cond: [{ $lte: ['$vencimento', today] }, '$total', 0] } },
            somaFuturo:    { $sum: { $cond: [{ $gt: ['$vencimento', today] }, '$total', 0] } },
            count:         { $sum: 1 },
          }}
        ]),
        InadimplenciaDetalhe.aggregate([
          { $match: { user: uid, status: { $ne: 'pago' } } },
          { $group: { _id: '$importStatus', soma: { $sum: '$total' }, count: { $sum: 1 } } }
        ]),
        InadimplenciaDetalhe.aggregate([
          { $match: { user: uid, lead: null, status: { $ne: 'pago' } } },
          { $group: { _id: null, soma: { $sum: '$total' }, count: { $sum: 1 } } }
        ])
      ]);

      res.json({
        somaTotal:     totais[0] ? totais[0].somaTotal     : 0,
        somaPrincipal: totais[0] ? totais[0].somaPrincipal : 0,
        somaVencido:   totais[0] ? totais[0].somaVencido   : 0,
        somaFuturo:    totais[0] ? totais[0].somaFuturo    : 0,
        count:         totais[0] ? totais[0].count         : 0,
        nullLeadCount: nullLeadInfo[0] ? nullLeadInfo[0].count : 0,
        nullLeadSoma:  nullLeadInfo[0] ? nullLeadInfo[0].soma  : 0,
        porImportStatus: porStatus
      });
    } catch (e) {
      logger.error('[getCarteiraTotals] Erro:', e);
      res.status(500).json({ message: e.message });
    }
  }

`;

const result = content.slice(0, idx) + NEW_METHOD + content.slice(idx);
fs.writeFileSync(path, result, 'utf8');
console.log('getCarteiraTotals added! Size change:', result.length - content.length);
