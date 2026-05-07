/**
 * fix_duplicate_debts.js
 *
 * Script de diagnóstico e deduplicação para registros InadimplenciaDetalhe.
 *
 * PROBLEMA: Ao importar planilha "detalhado" após a planilha "inadimplencia",
 * o sistema pode criar registros DUPLICADOS para o mesmo lançamento se as
 * colunas Esp/Elemento/Parcela existirem em uma planilha e não na outra
 * (chargeImportKey diferente → registro não encontrado → cria novo em vez de sobrescrever).
 *
 * COMO RODAR:
 *   node scratch/fix_duplicate_debts.js [--fix] [--userId=<id>]
 *
 * Sem --fix: apenas diagnostica (leitura segura)
 * Com --fix: remove os duplicados mais antigos (mantém o mais recente)
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');

const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--fix');
const userIdFilter = args.find(a => a.startsWith('--userId='))?.split('=')[1];

const InadimplenciaDetalhe = require('../src/models/InadimplenciaDetalhe');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
  console.log('✅ MongoDB conectado.');
  console.log(DRY_RUN ? '🔍 MODO DIAGNÓSTICO (sem --fix, nada será alterado)' : '⚠️  MODO CORREÇÃO (--fix ativado, duplicatas serão removidas)');
  if (userIdFilter) console.log(`👤 Filtrando usuário: ${userIdFilter}`);

  // Busca todos os registros agrupando por (user, lead, contrato, vencimento_dia)
  // para encontrar onde há mais de 1 lançamento para o mesmo dia/contrato/devedor
  const pipeline = [
    // Filtro por userId se especificado
    ...(userIdFilter ? [{ $match: { user: new mongoose.Types.ObjectId(userIdFilter) } }] : []),
    // Excluir pagos
    { $match: { status: { $ne: 'pago' } } },
    // Agrupa pela combinação chave (dia de vencimento, não hora exata)
    {
      $group: {
        _id: {
          user: '$user',
          lead: '$lead',
          contrato: '$contrato',
          // Agrupa por dia (ignora horas para tolerância de timezone)
          ano: { $year: '$vencimento' },
          mes: { $month: '$vencimento' },
          dia: { $dayOfMonth: '$vencimento' }
        },
        ids: { $push: '$_id' },
        batches: { $push: '$importBatch' },
        chargeKeys: { $push: '$chargeImportKey' },
        totals: { $push: '$total' },
        count: { $sum: 1 },
        clientes: { $addToSet: '$cliente' },
        importStatuses: { $addToSet: '$importStatus' },
        updatedAts: { $push: '$updatedAt' }
      }
    },
    // Apenas grupos com duplicatas
    { $match: { count: { $gt: 1 } } },
    { $sort: { count: -1 } }
  ];

  const duplicates = await InadimplenciaDetalhe.aggregate(pipeline);

  if (!duplicates.length) {
    console.log('\n✅ Nenhuma duplicata encontrada! O banco está consistente.');
    await mongoose.disconnect();
    return;
  }

  console.log(`\n⚠️  Encontrados ${duplicates.length} grupos com duplicatas:\n`);

  let totalToRemove = 0;
  const idsToRemove = [];

  for (const group of duplicates) {
    const { _id, ids, batches, totals, count, clientes, chargeKeys, updatedAts } = group;
    const totalSum = totals.reduce((a, b) => a + (b || 0), 0);

    console.log(`📋 ${clientes.join('/')} | Contrato: ${_id.contrato || '-'} | ${_id.dia}/${_id.mes}/${_id.ano}`);
    console.log(`   → ${count} registros (total somado = R$ ${totalSum.toFixed(2)})`);
    console.log(`   → IDs: ${ids.map(String).join(', ')}`);
    console.log(`   → Batches: ${batches.join(' | ')}`);
    console.log(`   → Chaves: ${chargeKeys.join(' | ')}`);
    console.log(`   → Status importação: ${group.importStatuses.join(', ')}`);

    // Estratégia: manter o mais recente (maior updatedAt), remover os demais
    // Cria array de {id, updatedAt} para ordenar
    const entries = ids.map((id, i) => ({ id, updatedAt: updatedAts[i] || new Date(0) }));
    entries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
    
    const toKeep = entries[0];
    const toDelete = entries.slice(1);

    console.log(`   → Manter: ${toKeep.id} (mais recente: ${toKeep.updatedAt})`);
    console.log(`   → Remover: ${toDelete.map(e => e.id).join(', ')}`);
    console.log('');

    toDelete.forEach(e => idsToRemove.push(e.id));
    totalToRemove += toDelete.length;
  }

  console.log(`\n📊 Total de registros a remover: ${totalToRemove}`);

  if (!DRY_RUN && idsToRemove.length > 0) {
    const result = await InadimplenciaDetalhe.deleteMany({ _id: { $in: idsToRemove } });
    console.log(`\n✅ Removidos: ${result.deletedCount} registros duplicados.`);
    console.log('   Reimporte as planilhas para verificar se os totais estão corretos.');
  } else if (DRY_RUN) {
    console.log('\n💡 Para corrigir, rode com --fix:');
    console.log('   node scratch/fix_duplicate_debts.js --fix');
    if (userIdFilter) console.log(`   node scratch/fix_duplicate_debts.js --fix --userId=${userIdFilter}`);
  }

  await mongoose.disconnect();
  console.log('\n🔌 Desconectado.');
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
