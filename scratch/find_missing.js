require('dotenv').config({ path: '.env' });
const mongoose = require('mongoose');
const xlsx = require('xlsx');
const InadimplenciaDetalhe = require('../src/models/InadimplenciaDetalhe');
const fs = require('fs');

const MONGO_URI = process.env.MONGO_URI || process.env.MONGODB_URI || process.env.DATABASE_URL;

const normalizeKey = (key) => String(key || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '').toLowerCase();

const col = (row, ...keys) => {
  const rowKeys = Object.keys(row);
  const normalizedKeys = keys.map(normalizeKey);
  for (const rowKey of rowKeys) {
    const normRowKey = normalizeKey(rowKey);
    if (normalizedKeys.includes(normRowKey)) {
      const val = row[rowKey];
      if (val === undefined || val === null || val === '') continue;
      if (val instanceof Date || typeof val === 'number') return val;
      const text = String(val).trim();
      if (text) return text;
    }
  }
  return null;
};

const parseDecimal = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  let s = String(val).trim();
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (s.includes(',')) s = s.replace(',', '.');
  const clean = s.replace(/[^\d.-]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
};

async function run() {
  console.log("Conectando ao banco...");
  await mongoose.connect(MONGO_URI);
  
  // Encontrar o usuario lucas
  const users = await mongoose.connection.db.collection('users').find({}).toArray();
  const userId = users.find(u => u.email === 'lucasgit10@gmail.com' || u.email === 'admin@qualif.ai' || true)._id;

  const dbRows = await InadimplenciaDetalhe.find({ user: userId }).lean();
  console.log(`Linhas no banco de dados para este usuario: ${dbRows.length}`);
  
  const somaBancoTotal = dbRows.filter(r => r.status !== 'pago').reduce((a, b) => a + (b.total || 0), 0);
  console.log(`Soma Total Pendente no Banco: R$ ${somaBancoTotal.toFixed(2)}`);

  const dbRowsByContrato = new Map();
  dbRows.forEach(r => {
    const cont = r.contrato || 'sem_contrato';
    if (!dbRowsByContrato.has(cont)) dbRowsByContrato.set(cont, []);
    dbRowsByContrato.get(cont).push(r);
  });

  // Procurar o arquivo xlsx mais recente no uploads
  const uploadDir = './uploads';
  let excelFile = null;
  if (fs.existsSync(uploadDir)) {
    const files = fs.readdirSync(uploadDir).filter(f => f.includes('DILC') || f.includes('INADIMPL'));
    if (files.length > 0) {
      files.sort((a,b) => fs.statSync(uploadDir+'/'+b).mtime.getTime() - fs.statSync(uploadDir+'/'+a).mtime.getTime());
      excelFile = uploadDir + '/' + files[0];
      console.log(`Usando arquivo de upload: ${excelFile}`);
    }
  }

  if (!excelFile) {
    console.log("Nenhum arquivo encontrado em uploads. O debug local ira falhar.");
    mongoose.disconnect();
    return;
  }

  const workbook = xlsx.readFile(excelFile, { cellDates: true });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

  console.log(`Linhas na planilha Excel: ${rows.length}`);

  let totalExcelValid = 0;
  const missing = [];
  const statusPagoNoBanco = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const cliente = col(row, 'Cliente', 'CLIENTE', 'NOME', 'Razao', 'Nome do Cliente');
    const contrato = col(row, 'Contrato', 'CONTRATO') || 'sem_contrato';
    const total = parseDecimal(col(row, 'Total', 'TOTAL', 'Valor'));
    const principal = parseDecimal(col(row, 'Principal', 'PRINCIPAL'));

    if (!cliente) continue;
    totalExcelValid += total;

    let found = false;
    let foundPago = false;
    const dbMatches = dbRowsByContrato.get(contrato) || [];
    
    for (let j = 0; j < dbMatches.length; j++) {
      const d = dbMatches[j];
      if (Math.abs(d.total - total) < 0.1 && !d.matched) {
        found = true;
        d.matched = true;
        if (d.status === 'pago') {
            foundPago = true;
            statusPagoNoBanco.push({ linha: i+2, cliente, total });
        }
        break;
      }
    }

    if (!found) {
      missing.push({ linha: i + 2, cliente, total });
    }
  }

  console.log(`\nSoma Total na Planilha: R$ ${totalExcelValid.toFixed(2)}`);
  console.log(`Linhas do excel que estao com status PAGO no banco: ${statusPagoNoBanco.length}`);
  if (statusPagoNoBanco.length > 0) {
      const somaPagos = statusPagoNoBanco.reduce((a,b)=>a+b.total, 0);
      console.log(`-> Soma desses pagos: R$ ${somaPagos.toFixed(2)}`);
  }

  console.log(`\nLinhas do excel que NAO FORAM ENCONTRADAS no banco: ${missing.length}`);
  if (missing.length > 0) {
      const somaMissing = missing.reduce((a,b)=>a+b.total, 0);
      console.log(`-> Soma dos ausentes: R$ ${somaMissing.toFixed(2)}`);
      console.log("Detalhes das linhas ausentes (primeiros 10):");
      missing.slice(0, 10).forEach(m => {
          console.log(`   Linha ${m.linha} - ${m.cliente} - R$ ${m.total}`);
      });
  }

  mongoose.disconnect();
}

run().catch(console.error);
