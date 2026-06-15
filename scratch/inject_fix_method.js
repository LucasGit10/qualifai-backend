const fs = require('fs');
const { execSync } = require('child_process');
const file = 'src/controllers/collections/spreadsheet.controller.js';
const content = fs.readFileSync(file, 'utf8');

const METHOD = `
  // ── Corrige registros com lead = null ─────────────────────────────────────
  async fixNullLeads(req, res) {
    try {
      const userId = req.user.id;
      const mongoose = require('mongoose');
      const uid = new mongoose.Types.ObjectId(userId);

      const nullRecords = await InadimplenciaDetalhe.find({ user: uid, lead: null }).lean();
      if (nullRecords.length === 0) {
        return res.json({ message: 'Nenhum registro com lead=null encontrado.', fixed: 0, totalNoBank: 0 });
      }

      let totalValorNulo = 0;
      nullRecords.forEach(r => { totalValorNulo += r.total || 0; });

      let fixed = 0, failed = 0;
      const seenClients = new Map();

      for (const rec of nullRecords) {
        const clientKey = rec.cpfCnpj + '_' + rec.cliente;
        if (seenClients.has(clientKey)) {
          await InadimplenciaDetalhe.updateMany(
            { user: uid, lead: null, cpfCnpj: rec.cpfCnpj, cliente: rec.cliente },
            { $set: { lead: seenClients.get(clientKey) } }
          );
          fixed++;
          continue;
        }
        const docNorm = rec.cpfCnpj ? String(rec.cpfCnpj).replace(/\\D/g,'') : null;
        let lead = null;
        if (docNorm) lead = await Lead.findOne({ user: uid, taxId: docNorm });
        if (!lead && docNorm) lead = await Lead.findOne({ user: uid, email: docNorm + '@importado.local' });
        if (!lead) {
          try {
            lead = await Lead.create({
              user: uid,
              name: rec.cliente || docNorm || 'Devedor Importado',
              email: docNorm ? docNorm + '@importado.local' : 'fix_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '@importado.local',
              taxId: docNorm,
              company: rec.empreendimento || 'Importado',
              source: 'form', status: 'novo', tags: ['novo'],
            });
          } catch (e) {
            if (e.code === 11000) lead = await Lead.findOne({ user: uid, email: docNorm ? docNorm + '@importado.local' : null });
          }
        }
        if (lead) {
          seenClients.set(clientKey, lead._id);
          await InadimplenciaDetalhe.updateMany(
            { user: uid, lead: null, cpfCnpj: rec.cpfCnpj, cliente: rec.cliente },
            { $set: { lead: lead._id } }
          );
          fixed++;
        } else { failed++; }
      }

      const agg = await InadimplenciaDetalhe.aggregate([
        { $match: { user: uid, status: { $ne: 'pago' } } },
        { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
      ]);
      const totalNoBank = agg[0] ? agg[0].total : 0;
      logger.info('[fixNullLeads] fixed=' + fixed + ' failed=' + failed + ' totalBanco=R$' + totalNoBank.toFixed(2));
      res.json({ message: fixed + ' clientes corrigidos, ' + failed + ' sem solucao.', fixed, failed, totalValorRecuperado: parseFloat(totalValorNulo.toFixed(2)), totalNoBank: parseFloat(totalNoBank.toFixed(2)) });
    } catch (e) {
      logger.error('[fixNullLeads] Erro: ' + e.message);
      res.status(500).json({ message: e.message });
    }
  }
`;

// Insere antes do fechamento da classe (último "}" antes de "module.exports")
const marker = '\nmodule.exports';
const insertIdx = content.lastIndexOf(marker);
if (insertIdx === -1) { console.error('Marker not found!'); process.exit(1); }

// Find the closing } of the class just before module.exports
const classBrace = content.lastIndexOf('}', insertIdx - 1);
if (classBrace === -1) { console.error('Class brace not found!'); process.exit(1); }

const newContent = content.slice(0, classBrace) + METHOD + '\n}' + content.slice(classBrace + 1);
fs.writeFileSync(file, newContent, 'utf8');

try {
  execSync('node --check "' + file + '"', { cwd: process.cwd() });
  console.log('Syntax OK!');
} catch(e) {
  console.error('Syntax error:', e.stderr ? e.stderr.toString() : e.message);
}
