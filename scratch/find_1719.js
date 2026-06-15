const fs = require('fs');
const xlsx = require('xlsx');

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

const filePath = 'C:/Users/USER/Downloads/DILCÉSAR_INADIMPLÊNCIA_2304.xlsx';
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

let sums = [];

for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const cliente = col(row, 'Cliente', 'CLIENTE', 'NOME', 'Razao', 'Nome do Cliente');
  const total = parseDecimal(col(row, 'Total', 'TOTAL', 'Valor'));
  
  if (total > 0 && cliente) {
    sums.push({ linha: i + 2, cliente, total });
  }
}

console.log(`Buscando combinação para R$ 1719,13 entre ${sums.length} linhas...`);

// Simple subset sum for 1719.13 (approx up to 3 elements)
const target = 1719.13;
const epsilon = 0.01;

let found = false;

for (let i = 0; i < sums.length; i++) {
  if (Math.abs(sums[i].total - target) < epsilon) {
    console.log("Achou 1 linha:", sums[i]); found = true;
  }
}

if (!found) {
  for (let i = 0; i < sums.length; i++) {
    for (let j = i+1; j < sums.length; j++) {
      if (Math.abs(sums[i].total + sums[j].total - target) < epsilon) {
        console.log("Achou 2 linhas:", sums[i], sums[j]); found = true;
      }
    }
  }
}

if (!found) {
  for (let i = 0; i < sums.length; i++) {
    for (let j = i+1; j < sums.length; j++) {
      for (let k = j+1; k < sums.length; k++) {
        if (Math.abs(sums[i].total + sums[j].total + sums[k].total - target) < epsilon) {
          console.log("Achou 3 linhas:", sums[i], sums[j], sums[k]); found = true;
        }
      }
    }
  }
}

if (!found) console.log("Nenhuma combinacao de ate 3 linhas achada.");
