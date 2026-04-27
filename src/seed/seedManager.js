const mongoose = require('mongoose');
const User = require('../models/User');
require('dotenv').config();
const connectDB = require('../config/database');

async function seedManager() {
  await connectDB();

  try {
    const managerEmail = 'manager@qualifai.tech';
    const managerPassword = 'Manager123@';

    const managerData = {
      name: 'Gerente',
      email: managerEmail,
      password: managerPassword,
      role: 'manager',
      emailVerified: true,
      isActive: true,
      plan: 'pro',
      settings: {
        theme: 'dark'
      }
    };

    let managerUser = await User.findOne({ email: managerEmail });
    if (managerUser) {
      console.log('Manager já existe. Atualizando dados...');
      Object.assign(managerUser, managerData);
      await managerUser.save();
    } else {
      console.log('Criando novo Manager...');
      managerUser = new User(managerData);
      await managerUser.save();
    }

    console.log('Seed Manager concluído com sucesso.');
    console.log(`Email: ${managerEmail}`);
    console.log(`Senha: ${managerPassword}`);

    await mongoose.disconnect();

  } catch (error) {
    console.error('Erro ao rodar seed manager:', error);
    process.exit(1);
  }
}

seedManager();
