/**
 * fix_null_leads.js
 * Encontra registros de InadimplenciaDetalhe com lead = null
 * e tenta atribuir um lead com base no CPF/CNPJ ou nome do cliente.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const InadimplenciaDetalhe = require('../src/models/InadimplenciaDetalhe');
const Lead = require('../src/models/Lead');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

async function run() {
  await mongoose.connect(MONGO_URI);
  console.log('Conectado ao MongoDB\n');

  // Encontra todos os registros sem lead
  const nullLeadRecords = await InadimplenciaDetalhe.find({ lead: null }).lean();
  console.log(`Registros com lead=null: ${nullLeadRecords.length}`);
  
  if (nullLeadRecords.length === 0) {
    console.log('Nenhum registro com lead nulo. O problema é outro.');
    await mongoose.disconnect();
    return;
  }

  let totalValor = 0;
  nullLeadRecords.forEach(r => { totalValor += r.total || 0; });
  console.log(`Total de valor nos registros com lead=null: R$ ${totalValor.toLocaleString('pt-BR', {minimumFractionDigits:2})}`);
  
  console.log('\nAmostra dos registros:');
  nullLeadRecords.slice(0, 5).forEach(r => {
    console.log(`  CPF: ${r.cpfCnpj} | Cliente: ${r.cliente} | Contrato: ${r.contrato} | Total: R$ ${(r.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})}`);
  });

  // Tenta corrigir: acha o lead pelo CPF/CNPJ
  let fixed = 0, failed = 0;
  const seenClients = new Set(); // evita processar o mesmo cliente múltiplas vezes

  for (const rec of nullLeadRecords) {
    const clientKey = `${rec.user}_${rec.cpfCnpj}_${rec.cliente}`;
    if (seenClients.has(clientKey)) { fixed++; continue; } // já foi corrigido neste loop
    seenClients.add(clientKey);

    const userId = rec.user;
    const docNorm = rec.cpfCnpj ? String(rec.cpfCnpj).replace(/\D/g,'') : null;
    const nome = rec.cliente;
    
    let lead = null;
    if (docNorm) {
      lead = await Lead.findOne({ user: userId, taxId: docNorm });
    }
    if (!lead && docNorm) {
      lead = await Lead.findOne({ user: userId, email: `${docNorm}@importado.local` });
    }
    if (!lead && nome) {
      // Cria o lead
      try {
        lead = await Lead.create({
          user: userId,
          name: nome || docNorm || 'Devedor Importado',
          email: docNorm ? `${docNorm}@importado.local` : `extra_${Date.now()}_${Math.random().toString(36).slice(2)}@importado.local`,
          taxId: docNorm,
          company: rec.empreendimento || 'Importado',
          source: 'form',
          status: 'novo',
          tags: ['novo'],
        });
        console.log(`  → Criou lead para ${nome} (${docNorm})`);
      } catch (e) {
        if (e.code === 11000) {
          // Email duplicado — busca novamente
          lead = await Lead.findOne({ user: userId, email: docNorm ? `${docNorm}@importado.local` : null });
        } else {
          console.error(`  ✗ Erro ao criar lead para ${nome}: ${e.message}`);
        }
      }
    }
    
    if (lead) {
      await InadimplenciaDetalhe.updateMany(
        { user: userId, lead: null, cpfCnpj: rec.cpfCnpj, cliente: rec.cliente },
        { $set: { lead: lead._id } }
      );
      fixed++;
    } else {
      console.log(`  ✗ Não encontrou/criou lead para: ${nome} (${docNorm})`);
      failed++;
    }
  }

  console.log(`\nResultado: ${fixed} clientes corrigidos, ${failed} sem solução`);

  // Verifica total geral no banco após correção
  const userId = nullLeadRecords[0]?.user;
  const agg = await InadimplenciaDetalhe.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(String(userId)), status: { $ne: 'pago' } } },
    { $group: { _id: null, total: { $sum: '$total' }, count: { $sum: 1 } } }
  ]);
  console.log(`\nTotal no banco agora: R$ ${(agg[0]?.total||0).toLocaleString('pt-BR',{minimumFractionDigits:2})} (${agg[0]?.count||0} registros)`);
  console.log('Esperado:             R$ 2.113.883,13 (inadimplência) ou R$ 2.335.257,94 (detalhado)');

  await mongoose.disconnect();
}

run().catch(e => { console.error(e); process.exit(1); });
