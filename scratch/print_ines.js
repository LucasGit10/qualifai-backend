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
const workbook = xlsx.readFile(filePath, { cellDates: true });
const sheet = workbook.Sheets[workbook.SheetNames[0]];
const rows = xlsx.utils.sheet_to_json(sheet, { defval: '' });

console.log("Linhas Ines Carolina:");
for (let i = 0; i < rows.length; i++) {
  const row = rows[i];
  const cliente = col(row, 'Cliente', 'CLIENTE', 'NOME', 'Razao', 'Nome do Cliente');
  
  if (cliente && String(cliente).includes('Ines Carolina')) {
    const date = col(row, 'Vencimento');
    const total = col(row, 'Total', 'total');
    console.log(`Linha ${i+2}: ${date} - R$ ${total}`);
  }
}
