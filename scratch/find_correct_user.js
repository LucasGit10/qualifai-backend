require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const InadimplenciaDetalhe = require('../src/models/InadimplenciaDetalhe');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

async function run() {
  await mongoose.connect(MONGO_URI);
  
  const agg = await InadimplenciaDetalhe.aggregate([
    {
        $group: {
            _id: "$user",
            count: { $sum: 1 },
            somaTotal: { $sum: "$total" },
            somaPrincipal: { $sum: "$principal" }
        }
    },
    { $sort: { count: -1 } }
  ]);

  console.log("=== Estatísticas por Usuário (Top 5) ===");
  for (let i = 0; i < Math.min(5, agg.length); i++) {
      const row = agg[i];
      console.log(`Usuario ID: ${row._id}`);
      console.log(`  Registros: ${row.count}`);
      console.log(`  Soma Total: R$ ${row.somaTotal.toFixed(2)}`);
      console.log(`  Soma Principal: R$ ${row.somaPrincipal.toFixed(2)}\n`);
  }
  
  mongoose.disconnect();
}
run().catch(console.error);
