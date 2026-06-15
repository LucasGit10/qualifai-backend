require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const InadimplenciaDetalhe = require('../src/models/InadimplenciaDetalhe');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

async function run() {
  await mongoose.connect(MONGO_URI);
  
  const users = await mongoose.connection.db.collection('users').find({}).toArray();
  const userId = users.find(u => u.email === 'lucasgit10@gmail.com' || u.email === 'admin@qualif.ai' || true)._id; // FALLBACK

  const targetId = '69eeb70ceb5c54437a9802d9'; // Dilcesar user ID that we saw earlier
  const uid = new mongoose.Types.ObjectId(targetId);

  const dbRows = await InadimplenciaDetalhe.find({ user: uid }).lean();
  console.log(`\n=== Usuario Dilcesar ===`);
  console.log(`Total de registros: ${dbRows.length}`);
  
  const somaBancoTotal = dbRows.filter(r => r.status !== 'pago').reduce((a, b) => a + (b.total || 0), 0);
  console.log(`Soma Total Pendente (sem os pagos): R$ ${somaBancoTotal.toFixed(2)}`);

  const pagosCount = dbRows.filter(r => r.status === 'pago').length;
  console.log(`Registros Pagos: ${pagosCount}`);
  
  mongoose.disconnect();
}
run().catch(console.error);
