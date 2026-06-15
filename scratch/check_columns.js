const xlsx = require('xlsx');
const path = require('path');

const filePath = 'uploads/1775688184226-cobrança_vencida.xlsx';

try {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet);
  
  if (rows.length > 0) {
      console.log('--- COLUNAS ENCONTRADAS NA PLANILHA ---');
      const allCols = Object.keys(rows[0]);
      console.log(JSON.stringify(allCols, null, 2));
      
      console.log('\n--- VERIFICAÇÃO ESPECÍFICA ---');
      const targets = ['APTO', 'ESP', 'ELEMENTO'];
      targets.forEach(t => {
          const match = allCols.find(c => c.toUpperCase().trim() === t);
          console.log(`${t}: ${match ? '✅ ENCONTRADA (' + match + ')' : '❌ NÃO ENCONTRADA'}`);
      });
  } else {
      console.log('Planilha está vazia ou sem cabeçalho.');
  }
} catch (e) {
  console.error('Erro ao ler planilha:', e.message);
}
