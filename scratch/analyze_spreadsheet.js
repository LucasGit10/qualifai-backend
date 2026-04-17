const xlsx = require('xlsx');
const path = require('path');

// No docker o caminho é relativo à raiz /app
const filePath = 'uploads/1775688184226-cobrança_vencida.xlsx';

const parseDecimal = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  let s = String(val).trim();
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  return isNaN(n) ? 0 : n;
};

try {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);
  
  console.log('Total de linhas:', rows.length);
  if (rows.length > 0) {
      console.log('Colunas encontradas:', Object.keys(rows[0]));
      
      console.log('\nAmostra de valores (primeiras 5 linhas):');
      rows.slice(0, 5).forEach((row, i) => {
        const vOriginal = row['VALOR_ORIGINAL'] || row['Valor Original'] || row['Valor'] || row['VALOR'];
        const vAtual = row['VALOR_ATUAL'] || row['Valor Atual'];
        console.log(`Linha ${i+1}: OriginalRaw="${vOriginal}" parsed=${parseDecimal(vOriginal)} | AtualRaw="${vAtual}" parsed=${parseDecimal(vAtual)}`);
      });

      const totalCalculado = rows.reduce((acc, row) => acc + parseDecimal(row['VALOR_ATUAL'] || row['Valor Atual'] || 0), 0);
      console.log('\nSoma Total Calculada pelo script (VALOR_ATUAL):', totalCalculado);

      const totalCalculadoOriginal = rows.reduce((acc, row) => acc + parseDecimal(row['VALOR_ORIGINAL'] || row['Valor Original'] || row['Valor'] || row['VALOR'] || 0), 0);
      console.log('Soma Total Calculada pelo script (VALOR_ORIGINAL):', totalCalculadoOriginal);
  }
  
} catch (e) {
  console.error('Erro ao ler planilha:', e.message);
}
