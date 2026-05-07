const fs = require('fs');
const path = 'src/controllers/collections/spreadsheet.controller.js';
let content = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// Injeta a auto-correcao de lead=null ANTES da agregacao dos totais
const MARKER = '        // \u2500\u2500 Totais reais da carteira completa (n\u00e3o apenas do batch atual) \u2500\u2500\u2500\u2500\u2500\u2500';
const idx = content.indexOf(MARKER);
if (idx === -1) { console.error('Marker not found!'); process.exit(1); }

const AUTO_FIX = `        // \u2500\u2500 PASSO 6: Auto-corre\u00e7\u00e3o de registros com lead=null \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
        // Garante que todos os registros tenham um lead v\u00e1lido ap\u00f3s o import
        try {
          const nullRecords = await InadimplenciaDetalhe.find({ user: new ObjectId(userId), lead: null })
            .select('_id cpfCnpj cliente empreendimento').lean();
          if (nullRecords.length > 0) {
            logger.warn('[importGeneric] ' + nullRecords.length + ' registros com lead=null. Corrigindo...');
            const seenFix = new Map();
            for (const rec of nullRecords) {
              const clientKey = (rec.cpfCnpj || '') + '_' + (rec.cliente || '');
              if (seenFix.has(clientKey)) {
                await InadimplenciaDetalhe.updateMany(
                  { user: new ObjectId(userId), lead: null, cpfCnpj: rec.cpfCnpj, cliente: rec.cliente },
                  { $set: { lead: seenFix.get(clientKey) } }
                );
                continue;
              }
              const docNorm = rec.cpfCnpj ? String(rec.cpfCnpj).replace(/\\D/g, '') : null;
              let fixedLead = null;
              if (docNorm) fixedLead = await Lead.findOne({ user: new ObjectId(userId), taxId: docNorm }).select('_id').lean();
              if (!fixedLead && docNorm) fixedLead = await Lead.findOne({ user: new ObjectId(userId), email: docNorm + '@importado.local' }).select('_id').lean();
              if (!fixedLead) {
                try {
                  const created = await Lead.create({
                    user: new ObjectId(userId),
                    name: rec.cliente || docNorm || 'Devedor Importado',
                    email: docNorm ? docNorm + '@importado.local' : 'fix_' + Date.now() + '_' + Math.random().toString(36).slice(2) + '@importado.local',
                    taxId: docNorm,
                    company: rec.empreendimento || 'Importado',
                    source: 'form', status: 'novo', tags: ['novo'],
                  });
                  fixedLead = created;
                } catch (dupErr) {
                  if (dupErr.code === 11000 && docNorm) {
                    fixedLead = await Lead.findOne({ user: new ObjectId(userId), taxId: docNorm }).select('_id').lean();
                  }
                }
              }
              if (fixedLead) {
                seenFix.set(clientKey, fixedLead._id);
                await InadimplenciaDetalhe.updateMany(
                  { user: new ObjectId(userId), lead: null, cpfCnpj: rec.cpfCnpj, cliente: rec.cliente },
                  { $set: { lead: fixedLead._id } }
                );
              }
            }
            logger.info('[importGeneric] Auto-fix lead=null conclu\u00eddo.');
          }
        } catch (fixErr) {
          logger.error('[importGeneric] Erro no auto-fix de lead=null: ' + fixErr.message);
        }

`;

const result = content.slice(0, idx) + AUTO_FIX + content.slice(idx);
fs.writeFileSync(path, result, 'utf8');
console.log('Auto-fix lead=null injected! Size change:', result.length - content.length);
