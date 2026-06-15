const fs = require('fs');
const path = 'src/controllers/collections/spreadsheet.controller.js';
let content = fs.readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

// Localiza a partir do marcador conhecido (menos dependente de caracteres especiais)
const START = '        if (leadsToCreate.length > 0) {\n          try { await Lead.insertMany(leadsToCreate, { ordered: false }); }\n          catch (e) { if (e.code !== 11000) throw e; }\n        }\n\n        const BATCH = 500;\n        for (let b = 0; b < debtBulkOps.length; b += BATCH) {\n          await InadimplenciaDetalhe.bulkWrite(debtBulkOps.slice(b, b + BATCH), { ordered: false });\n        }';

const idx = content.indexOf(START);
console.log('Found at idx:', idx);
if (idx === -1) {
  // Debug: show actual chars
  const partialIdx = content.indexOf('if (leadsToCreate.length > 0)');
  console.log('Partial idx:', partialIdx);
  if (partialIdx > -1) console.log('Chars:', JSON.stringify(content.slice(partialIdx, partialIdx + 50)));
  process.exit(1);
}

const REPLACEMENT = `        // Mapa de remapeamento: tempId -> realId para leads que falharam E11000
        const leadIdRemap = new Map();

        if (leadsToCreate.length > 0) {
          try {
            await Lead.insertMany(leadsToCreate, { ordered: false });
          } catch (e) {
            if (e.code !== 11000 && !e.writeErrors) throw e;
            // Alguns leads j\u00e1 existiam (E11000) \u2014 remapeia o tempId para o _id real
            // caso contr\u00e1rio as d\u00edvidas ficam apontando para ObjectId fantasma (lead=null efetivo)
            const failedLeads = e.writeErrors
              ? e.writeErrors.map(we => leadsToCreate[we.index]).filter(Boolean)
              : leadsToCreate;
            for (const fl of failedLeads) {
              const tempId = String(fl._id);
              const realLead = fl.taxId
                ? await Lead.findOne({ user: new ObjectId(userId), taxId: fl.taxId }).select('_id').lean()
                : await Lead.findOne({ user: new ObjectId(userId), email: fl.email }).select('_id').lean();
              if (realLead) leadIdRemap.set(tempId, realLead._id);
            }
          }
        }

        // Corrige insertOne que apontam para tempIds que n\u00e3o foram salvos (E11000)
        if (leadIdRemap.size > 0) {
          logger.info('[importGeneric] Remapeando ' + leadIdRemap.size + ' lead(s) tempor\u00e1rios para IDs reais.');
          for (const op of debtBulkOps) {
            if (op.insertOne) {
              const tid = String(op.insertOne.document.lead);
              if (leadIdRemap.has(tid)) op.insertOne.document.lead = leadIdRemap.get(tid);
            }
          }
        }

        const BATCH = 500;
        for (let b = 0; b < debtBulkOps.length; b += BATCH) {
          await InadimplenciaDetalhe.bulkWrite(debtBulkOps.slice(b, b + BATCH), { ordered: false });
        }`;

const result = content.slice(0, idx) + REPLACEMENT + content.slice(idx + START.length);
fs.writeFileSync(path, result, 'utf8');
console.log('Patch applied! Size change:', result.length - content.length);
