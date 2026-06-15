const xlsx = require('xlsx');
const path = require('path');

const filePath = path.join('c:/repo/qualifai', 'cobrança vencida.xlsx');
try {
  const workbook = xlsx.readFile(filePath);
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(sheet, { header: 1 });
  
  if (data.length > 0) {
    console.log('Headers found:', data[0]);
    console.log('Sample row:', data[1]);
  } else {
    console.log('Sheet is empty');
  }
} catch (e) {
  console.error('Error reading file:', e);
}
