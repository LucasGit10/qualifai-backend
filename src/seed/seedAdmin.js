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

    const adminEmail = process.env.SEED_ADMIN_EMAIL || 'admin@qualifai.tech';
    const adminPassword = process.env.SEED_ADMIN_PASSWORD || 'Admin123@';

    const adminData = {
      name: 'Administrador',
      email: adminEmail,
      password: adminPassword,
      role: 'admin',
      emailVerified: true,
      isActive: true,
      plan: 'pro',
      settings: {
        theme: 'dark',
        aiConfig: {
          agentName: 'QualifAI Manager',
          communicationStyle: 'Normal',
          personality: 'professional'
        }
      }
    };

    let adminUser = await User.findOne({ email: adminEmail });
    if (adminUser) {
      console.log('Admin já existe. Atualizando dados...');
      Object.assign(adminUser, adminData);
      await adminUser.save();
    } else {
      console.log('Criando novo Admin...');
      adminUser = new User(adminData);
      await adminUser.save();
    }

    fs.writeFileSync(lockFilePath, JSON.stringify({
      createdAt: new Date().toISOString(),
      info: 'Seed admin executado com sucesso'
    }, null, 2));

    console.log('Seed Admin concluído com sucesso.');

    await mongoose.disconnect();

  } catch (error) {
    console.error('Erro ao rodar seed admin:', error);
    process.exit(1);
  }
}

seedAdmin();
