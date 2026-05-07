require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Conectado ao MongoDB!');
  
  const schema = new mongoose.Schema({}, { strict: false });
  const InadimplenciaDetalhe = mongoose.models.InadimplenciaDetalhe || 
    mongoose.model('InadimplenciaDetalhe', schema, 'inadimplenciadetalhes');
  
  const users = await InadimplenciaDetalhe.distinct('user');
  console.log('Usuarios com dados:', users.length);
  
  const fmt = v => (v||0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  for (const userId of users) {
    const uid = new mongoose.Types.ObjectId(String(userId));
    
    const totais = await InadimplenciaDetalhe.aggregate([
      { $match: { user: uid, status: { $ne: 'pago' } } },
      { $group: { _id: null, somaTotal: { $sum: '$total' }, somaPrincipal: { $sum: '$principal' }, count: { $sum: 1 } } }
    ]);
    
    const comNullLead = await InadimplenciaDetalhe.countDocuments({ user: uid, lead: null });
    const batches = await InadimplenciaDetalhe.distinct('importBatch', { user: uid });
    
    console.log('\n=== Usuario:', String(userId), '===');
    console.log('Total registros (nao pagos):', totais[0] ? totais[0].count : 0);
    console.log('Soma Total (com juros):      ', fmt(totais[0] ? totais[0].somaTotal : 0));
    console.log('Soma Principal:              ', fmt(totais[0] ? totais[0].somaPrincipal : 0));
    console.log('Registros com lead=null:     ', comNullLead);
    console.log('Batches importados:', batches.length, '->', batches.slice(-3).join(' | '));
    
    const porStatus = await InadimplenciaDetalhe.aggregate([
      { $match: { user: uid, status: { $ne: 'pago' } } },
      { $group: { _id: '$importStatus', soma: { $sum: '$total' }, count: { $sum: 1 } } }
    ]);
    console.log('Por importStatus:');
    porStatus.forEach(s => console.log('  ', s._id + ':', s.count, 'reg |', fmt(s.soma)));

    // Soma registros com lead=null
    const totaisNullLead = await InadimplenciaDetalhe.aggregate([
      { $match: { user: uid, lead: null, status: { $ne: 'pago' } } },
      { $group: { _id: null, somaTotal: { $sum: '$total' }, count: { $sum: 1 } } }
    ]);
    if (totaisNullLead[0]) {
      console.log('Valor PERDIDO (lead=null):', fmt(totaisNullLead[0].somaTotal), '(' + totaisNullLead[0].count + ' reg)');
    }
  }
  
  await mongoose.disconnect();
  console.log('\nPronto!');
}

run().catch(e => { console.error('ERRO:', e.message); process.exit(1); });
