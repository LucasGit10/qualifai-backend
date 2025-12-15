const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();
const bcrypt = require('bcryptjs');
const connectDB = require('../config/database');
const lockFilePath = path.resolve(__dirname, '../.qualifai_seed_lock.json');

async function seedAdmin() {
  await connectDB();

  try {
    const adminExists = await User.findOne({ role: 'admin' });
    const lockFileExists = fs.existsSync(lockFilePath);

    if (adminExists && !lockFileExists) {
      fs.writeFileSync(lockFilePath, JSON.stringify({
        createdAt: new Date().toISOString(),
        info: 'Lock criado automaticamente pois admin já existe'
      }, null, 2));
      console.log('Arquivo lock criado automaticamente pois admin já existe.');
      await mongoose.disconnect();
      return;
    }

    if (lockFileExists) {
      console.log('Seed admin bloqueado pelo arquivo de lock. Nada a fazer.');
      await mongoose.disconnect();
      return;
    }

    if (!adminExists && !lockFileExists) {
      const adminEmail = process.env.SEED_ADMIN_EMAIL;
      const adminPassword = process.env.SEED_ADMIN_PASSWORD;

      if (!adminEmail || !adminPassword) {
        console.error('Por favor configure SEED_ADMIN_EMAIL e SEED_ADMIN_PASSWORD no .env');
        process.exit(1);
      }

      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(adminPassword, salt);

      const adminUser = new User({
        name: 'Administrador',
        email: adminEmail,
        password: hashedPassword,
        role: 'admin',
        emailVerified: true,
        isActive: true,
      });

      await adminUser.save();

      fs.writeFileSync(lockFilePath, JSON.stringify({
        createdAt: new Date().toISOString(),
        info: 'Seed admin criada com sucesso'
      }, null, 2));

      console.log('Admin criado com sucesso e seed bloqueado.');
    }

    await mongoose.disconnect();

  } catch (error) {
    console.error('Erro ao rodar seed admin:', error);
    process.exit(1);
  }
}

seedAdmin();
