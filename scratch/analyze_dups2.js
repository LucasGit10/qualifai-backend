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

const filePath = 'C:/Users/USER/Downloads/DILCÉSAR_INADIMPLÊNCIA_2304.xlsx';
const workbook = xlsx.readFile(filePath);
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

let counts = {};
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const cliente = col(row, 'Cliente', 'CLIENTE', 'NOME', 'Razao', 'Nome do Cliente');
  const total = parseFloat(String(col(row, 'Total', 'TOTAL', 'Valor')||'0').replace(/[^\d.-]/g,''));
  
  if (!cliente) continue;
  counts[cliente] = (counts[cliente] || 0) + 1;
}

const duplicates = Object.entries(counts).filter(([c, count]) => count > 1).sort((a,b) => b[1] - a[1]);
console.log("Clientes com mais de 1 linha:", duplicates.length);
