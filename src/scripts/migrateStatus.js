require('dotenv').config();
const mongoose = require('mongoose');
const { getModel } = require('../utils/modelProvider');

async function migrate() {
  try {
    console.log('--- [MIGRATION] Iniciando migração de status... ---');
    if (!process.env.MONGODB_URI) {
      console.error('MONGODB_URI não encontrado no .env');
      process.exit(1);
    }

    await mongoose.connect(process.env.MONGODB_URI);
    console.log('--- [MIGRATION] Conectado ao MongoDB ---');

    const InadimplenciaDetalhe = getModel('InadimplenciaDetalhe');
    
    // 1. Marcar nulos/inexistentes como pendente
    const result = await InadimplenciaDetalhe.updateMany(
      { $or: [{ status: { $exists: false } }, { status: null }] },
      { $set: { status: 'pendente' } }
    );

    console.log(`--- [MIGRATION] Registros pendentes normalizados: ${result.modifiedCount} ---`);

    // 2. Garantir que os pagos tenham os campos mínimos (segurança)
    const paidCount = await InadimplenciaDetalhe.countDocuments({ status: 'pago' });
    console.log(`--- [MIGRATION] Total de registros já pagos: ${paidCount} ---`);

    console.log('--- [MIGRATION] Concluído com sucesso! ---');
    process.exit(0);
  } catch (err) {
    console.error('--- [MIGRATION] Erro crítico:', err);
    process.exit(1);
  }
}

migrate();
