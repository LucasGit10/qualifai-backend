/**
 * spreadsheetController.js
 * Importação das 3 planilhas do sistema de cobrança:
 *   1. SPC (SPC_MR, SPC_GT)
 *   2. Contas a Receber (MARCA_REGISTRADA, GRAN_TORO)
 *   3. Inadimplência Detalhado (INADIMPLENCIA_DETALHADO, PLAN1)
 *
 * Estratégia de vinculação ao Lead:
 *   - SPC: usa NUMERO_DOCUMENTO (CPF/CNPJ) + EMAIL
 *   - Contas a Receber: usa CLIENTE (nome) + CONTRATO
 *   - Inadimplência: usa CPF_CNPJ + CONTRATO
 *   Se o Lead não for encontrado, cria um novo automaticamente.
 */

const fs = require('fs');
const path = require('path');
const csvParser = require('csv-parser');
const xlsx = require('xlsx');
const { getModel } = require('../../utils/modelProvider');
const logger = require('../../utils/logger');

const Lead = getModel('Lead');
const SpcRecord = getModel('SpcRecord');
const ContasReceber = getModel('ContasReceber');
const InadimplenciaDetalhe = getModel('InadimplenciaDetalhe');

// â”€â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Detecta separador de CSV automaticamente */
const detectSeparator = (filePath) => new Promise((resolve) => {
  const stream = fs.createReadStream(filePath, { encoding: 'utf-8' });
  let header = '';
  stream.on('data', (chunk) => { header = chunk.toString(); stream.destroy(); });
  stream.on('close', () => {
    if (!header) return resolve(',');
    const firstLine = header.split('\n')[0];
    resolve((firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',');
  });
  stream.on('error', () => resolve(','));
});

/** Lê registros de um arquivo (CSV ou Excel) */
const normalizeKey = (k) => String(k || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s/g, '');

const findSpreadsheetHeaderIndex = (rows) => rows.findIndex((row) => {
  const normalized = (row || []).map(normalizeKey).filter(Boolean);
  const hasDebtor = ['cliente', 'cpf/cnpj', 'cpf', 'cnpj', 'documento'].some((key) => normalized.includes(normalizeKey(key)));
  const coreCount = ['vencimento', 'principal', 'total'].filter((key) => normalized.includes(normalizeKey(key))).length;
  return hasDebtor && coreCount >= 2;
});

const rowsToObjectsFromDetectedHeader = (rows, sheetName) => {
  const headerIndex = findSpreadsheetHeaderIndex(rows);
  if (headerIndex === -1) {
    logger.warn(`[Spreadsheet] Aba ${sheetName} ignorada: cabeçalho Cliente/Vencimento/Principal/Total não encontrado.`);
    return [];
  }

  const headers = rows[headerIndex].map((header, index) => {
    const name = String(header || '').trim();
    return name || `__EMPTY_${index}`;
  });

  return rows.slice(headerIndex + 1).reduce((items, row) => {
    if (!row || row.every((value) => value === null || value === undefined || value === '')) return items;
    const item = {};
    headers.forEach((header, index) => {
      if (!header.startsWith('__EMPTY_')) item[header] = row[index] ?? null;
    });
    if (col(item, 'Cliente', 'CPF/CNPJ', 'CPF', 'CNPJ', 'Documento')) items.push(item);
    return items;
  }, []);
};

const readFileRecords = async (filePath, fileExt) => {
  if (fileExt === '.csv') {
    const separator = await detectSeparator(filePath);
    const records = [];
    await new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
        .pipe(csvParser({ separator }))
        .on('data', (row) => records.push(row))
        .on('end', resolve)
        .on('error', reject);
    });
    return records;
  } else if (['.xlsx', '.xls'].includes(fileExt)) {
    const workbook = xlsx.readFile(filePath, { cellDates: true });
    let allRecords = [];
    
    // Percorre todas as abas da planilha
    workbook.SheetNames.forEach(sheetName => {
      const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: null, blankrows: false });
      const sheetRecords = rowsToObjectsFromDetectedHeader(rows, sheetName);
      if (Array.isArray(sheetRecords)) {
        allRecords = allRecords.concat(sheetRecords);
      }
    });
    
    return allRecords;
  }
  throw new Error(`Formato não suportado: ${fileExt}`);
};

/** Normaliza nome de coluna para comparação robusta: remove espaços, acento e case */

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

/** Converte string de data para Date (suporta dd/mm/yyyy e yyyy-mm-dd) */
const parseDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val; // Já é um objeto Date
  if (typeof val === 'number') {
    const d = new Date((val - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  const s = String(val).trim();
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return new Date(s);
  // DD/MM/YYYY
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`);
  // Número serial do Excel
  const n = parseFloat(s);
  if (!isNaN(n) && n > 30000) {
    const d = new Date((n - 25569) * 86400 * 1000);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
};

/** Converte string para decimal (suporta formato brasileiro e internacional) */
const parseDecimal = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return val;
  let s = String(val).trim();
  
  // Se tem vírgula e ponto, descobrimos qual é o decimal
  if (s.includes(',') && s.includes('.')) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      // Formato BR: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato US: 1,234.56
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    // Só tem vírgula: assumimos decimal BR 1234,56
    s = s.replace(',', '.');
  }
  
  // Remove tudo que não for dígito ou ponto ou sinal de menos
  const clean = s.replace(/[^\d.-]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
};

const normalizePhone = (phone) => {
  if (!phone) return null;
  const clean = String(phone).replace(/\D/g, '');
  if (!clean) return null;
  
  // Se tem 10 ou 11 dígitos, provavelmente é Brasil sem o 55
  if (clean.length === 10 || clean.length === 11) {
    return '55' + clean;
  }
  return clean;
};

const normalizeText = (value) => String(value || '')
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .toLowerCase();

const normalizeDocument = (value) => {
  const clean = String(value || '').replace(/\D/g, '');
  return clean || null;
};

const getDebtorImportKey = ({ cpfCnpj, cliente, lead }) => {
  const doc = normalizeDocument(cpfCnpj);
  if (doc) return `doc:${doc}`;
  const name = normalizeText(cliente);
  if (name) return `nome:${name}`;
  return lead ? `lead:${lead}` : null;
};

const getDebtorImportKeyFromRow = (row) => getDebtorImportKey({
  cpfCnpj: col(row, 'CPF/CNPJ', 'CPF', 'CNPJ', 'cpfCnpj', 'Documento'),
  cliente: col(row, 'Cliente', 'CLIENTE', 'NOME', 'Razao', 'Nome do Cliente')
});

const getDateKey = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
};

const normalizeKeyPart = (value) => normalizeText(value).replace(/[|]/g, '');

const getChargeImportKey = ({ debtorImportKey, contrato, vencimento, esp, elemento, parcela, taxaExtra }) => [
  debtorImportKey,
  normalizeKeyPart(contrato),
  getDateKey(vencimento),
  normalizeKeyPart(esp),
  normalizeKeyPart(elemento),
  parcela || '',
  normalizeKeyPart(taxaExtra)
].join('|');

const getNextOccurrenceKey = (map, baseKey) => {
  const occurrence = (map.get(baseKey) || 0) + 1;
  map.set(baseKey, occurrence);
  return `${baseKey}|seq:${occurrence}`;
};

const getDateRange = (date) => {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

const formatImportStatus = (status) => {
  const map = {
    novo: 'Novo na importacao',
    mantido: 'Permanece na importacao',
    saiu: 'Saiu da importacao'
  };
  return map[status] || 'Sem comparacao';
};

/** Busca ou cria um Lead pelo CPF/CNPJ ou e-mail de forma atômica/robusta */
const findOrCreateLead = async (userId, { cpfCnpj, nome, email, telefone, telefone2, empresa }) => {
  try {
    const docNorm = cpfCnpj ? cpfCnpj.replace(/\D/g, '') : null;
    const generatedEmail = email ? email.toLowerCase() : (docNorm ? `${docNorm}@importado.local` : null);

    const phone1 = normalizePhone(telefone);
    const phone2 = normalizePhone(telefone2);

    // Busca robusta: tenta por taxId (CPF/CNPJ) OU pelo e-mail gerado/fornecido
    let lead = await Lead.findOne({ 
      user: userId, 
      $or: [
        ...(docNorm ? [{ taxId: docNorm }] : []),
        ...(generatedEmail ? [{ email: generatedEmail }] : [])
      ]
    });

    const newContacts = [];
    if (phone1) newContacts.push({ type: 'phone', value: phone1, label: 'Telefone 1' });
    if (phone2) newContacts.push({ type: 'phone', value: phone2, label: 'Telefone 2' });
    if (email)   newContacts.push({ type: 'email', value: email.toLowerCase(), label: 'E-mail Planilha' });

    if (!lead) {
      lead = new Lead({
        user: userId,
        name: nome || cpfCnpj || 'Devedor Importado',
        email: generatedEmail || `extra_${Date.now()}@importado.local`,
        taxId: docNorm,
        phone: phone1 || phone2 || null,
        company: empresa || 'Importado',
        source: 'form',
        status: 'novo',
        tags: ['novo'],
        contacts: newContacts
      });
      await lead.save();
    } else {
      // Se encontrou, atualiza os contatos principais se estiverem vazios
      let multiUpdate = false;
      if (!lead.phone && phone1) { lead.phone = phone1; multiUpdate = true; }
      if (!lead.phone && phone2 && !phone1) { lead.phone = phone2; multiUpdate = true; }
      if (lead.company === 'Importado' && empresa) { lead.company = empresa; multiUpdate = true; }
      if (!lead.taxId && docNorm) { lead.taxId = docNorm; multiUpdate = true; }
      
      // Adiciona novos contatos ao array sem duplicar o "value"
      if (!lead.contacts) lead.contacts = [];
      newContacts.forEach(nc => {
        const exists = lead.contacts.some(c => c.value === nc.value);
        if (!exists) {
          lead.contacts.push(nc);
          multiUpdate = true;
        }
      });

      if (multiUpdate) await lead.save();
    }
    return lead;
  } catch (e) {
    logger.warn(`[Spreadsheet] Erro ao processar lead (${cpfCnpj}): ${e.message}`);
    
    // Fallback agressivo caso ainda dê conflito (ex: race condition em imports paralelos)
    if (e.message && e.message.includes('E11000')) {
      // Tenta pelo CPF/CNPJ primeiro (mais confiável, sempre presente na planilha)
      const docNorm = cpfCnpj ? cpfCnpj.replace(/\D/g, '') : null;
      if (docNorm) {
        const byDoc = await Lead.findOne({ user: userId, taxId: docNorm });
        if (byDoc) return byDoc;
      }
      // Tenta pelo e-mail gerado automaticamente
      const generatedEmail = email ? email.toLowerCase() : (docNorm ? `${docNorm}@importado.local` : null);
      if (generatedEmail) {
        const byEmail = await Lead.findOne({ user: userId, email: generatedEmail });
        if (byEmail) return byEmail;
      }
      // Tenta pelo e-mail fornecido
      if (email) {
        const byOriginalEmail = await Lead.findOne({ user: userId, email: email.toLowerCase() });
        if (byOriginalEmail) return byOriginalEmail;
      }
    }
    return null;
  }
};

// â”€â”€â”€ Controller â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class SpreadsheetController {

  // â”€â”€ Importação Genérica de Planilha de Cobrança (UPSERT) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async importGeneric(req, res) {
    if (!req.file) return res.status(400).json({ message: 'Arquivo é obrigatório.' });
    
    const userId = req.user.id;
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const arquivoOrigem = req.body.arquivoOrigem || req.file.originalname;
    const importBatch = `${new Date().toISOString().replace(/[:.]/g, '-')}_${req.file.originalname}`;
    const io = req.app.get('io');

    let records;
    try {
      records = await readFileRecords(filePath, fileExt);
      console.log(`[Import] Arquivo lido. Total de linhas: ${records.length}`);
      if (!records.length) {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(400).json({
          message: 'Nenhuma linha válida encontrada. Verifique se a planilha tem colunas Cliente, Vencimento, Principal e Total.'
        });
      }
    } catch (readErr) {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(400).json({ message: `Erro ao ler o arquivo: ${readErr.message}` });
    }

    // â”€â”€â”€ Responde IMEDIATAMENTE para não sofrer timeout do proxy â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // O processamento real roda em background e notifica via socket.io
    res.status(202).json({ success: true, importBatch, total: records.length, message: 'Importação iniciada em background.' });

    // â”€â”€â”€ Processamento em background â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    // ─── Processamento em background (bulk) ─────────────────────────────────
    setImmediate(async () => {
      const mongoose = require('mongoose');
      const ObjectId = mongoose.Types.ObjectId;
      let created = 0, updated = 0, errors = 0, newDebtors = 0, exitedDebtors = 0, skippedDuplicates = 0;
      try {
        if (io) io.emit('spreadsheet-progress', { percent: 2, current: 0, total: records.length, status: 'extraindo' });

        // ── PASSO 1: Carrega todos os leads do usuário em memória (1 query) ──────────────
        const existingLeads = await Lead.find({ user: userId }).select('_id taxId email name phone company contacts').lean();
        const leadByTaxId = new Map();
        const leadByEmail = new Map();
        existingLeads.forEach(l => {
          if (l.taxId) leadByTaxId.set(l.taxId, l);
          if (l.email) leadByEmail.set(l.email, l);
        });

        // ── PASSO 2: Carrega todos os registros de dívida existentes em memória (1 query) ─
        const existingDebts = await InadimplenciaDetalhe.find({ user: userId }).select(
          '_id chargeImportKey lead contrato vencimento esp elemento parcela status importStatus firstSeenBatch importBatch cpfCnpj cliente'
        ).lean();

        // Índices para match rápido em memória
        const debtByChargeKey = new Map();  // chargeImportKey -> debt
        const debtByFallback  = new Map();  // fallback key -> debt
        existingDebts.forEach(d => {
          if (d.chargeImportKey) debtByChargeKey.set(d.chargeImportKey, d);
          const fbKey = String(d.lead) + '|' + (d.contrato || '') + '|' + (d.vencimento ? new Date(d.vencimento).toISOString().slice(0,10) : '') + '|' + (d.esp||'') + '|' + (d.elemento||'') + '|' + (d.parcela||'');
          if (!debtByFallback.has(fbKey)) debtByFallback.set(fbKey, d);
        });

        // previousDebtors para lógica de "saiu"
        const previousDebtors = new Map();
        existingDebts.filter(d => d.status !== 'pago' && d.importStatus !== 'saiu').forEach(d => {
          const key = getDebtorImportKey({ cpfCnpj: d.cpfCnpj, cliente: d.cliente, lead: d.lead });
          if (!key) return;
          if (!previousDebtors.has(key)) previousDebtors.set(key, { leadIds: new Set(), cpfCnpj: d.cpfCnpj, cliente: d.cliente });
          if (d.lead) previousDebtors.get(key).leadIds.add(String(d.lead));
        });

        if (io) io.emit('spreadsheet-progress', { percent: 10, current: 0, total: records.length, status: 'extraindo' });

        // ── PASSO 3: Processa cada linha em memória ─────────────────────────────────────
        const currentDebtorKeys = new Set(records.map(getDebtorImportKeyFromRow).filter(Boolean));
        const chargeOccurrences = new Map();
        const leadsToCreate = [];
        const debtBulkOps   = [];
        const seenChargeKeys = new Set();

        for (let i = 0; i < records.length; i++) {
          try {
            const row = records[i];
            const cpfCnpj     = col(row, 'CPF/CNPJ', 'CPF', 'CNPJ', 'cpfCnpj', 'Documento');
            const clienteNome = col(row, 'Cliente', 'CLIENTE', 'NOME', 'Razao', 'Nome do Cliente');
            const contrato    = col(row, 'Contrato', 'CONTRATO', 'Numero do Contrato');
            const vencimento  = parseDate(col(row, 'Vencimento', 'VENCIMENTO', 'DATA_VENCIMENTO', 'Data do Vencimento'));

            if (!clienteNome && !cpfCnpj) { errors++; continue; }
            if (!vencimento) { errors++; continue; }

            const debtorImportKey = getDebtorImportKey({ cpfCnpj, cliente: clienteNome });
            const rowImportStatus = previousDebtors.has(debtorImportKey) ? 'mantido' : 'novo';

            // Resolve Lead em memória
            const docNorm = cpfCnpj ? String(cpfCnpj).replace(/\D/g, '') : null;
            const emailInput = col(row, 'E-mail', 'Email', 'EMAIL');
            const generatedEmail = emailInput ? emailInput.toLowerCase() : (docNorm ? docNorm + '@importado.local' : null);

            let lead = (docNorm ? leadByTaxId.get(docNorm) : null)
                    || (generatedEmail ? leadByEmail.get(generatedEmail) : null);

            if (!lead) {
              const tempId = new ObjectId();
              const newLead = {
                _id: tempId,
                user: new ObjectId(userId),
                name: clienteNome || cpfCnpj || 'Devedor Importado',
                email: generatedEmail || ('extra_' + Date.now() + '_' + i + '@importado.local'),
                taxId: docNorm,
                phone: normalizePhone(col(row, 'Telefone 1', 'TELEFONE1', 'Telefone', 'Celular', 'TELEFONE 1')) || null,
                company: col(row, 'Empreendimento', 'EMPREENDIMENTO', 'Empresa') || 'Importado',
                source: 'form', status: 'novo', tags: ['novo'], contacts: []
              };
              leadsToCreate.push(newLead);
              if (docNorm) leadByTaxId.set(docNorm, newLead);
              if (generatedEmail) leadByEmail.set(generatedEmail, newLead);
              lead = newLead;
            }

            const esp       = col(row, 'Esp', 'ESP') || null;
            const elemento  = col(row, 'Elemento', 'ELEMENTO') || null;
            const parcelaRaw = col(row, 'Parcela', 'PARCELA');
            const parcela   = parseInt(parcelaRaw || '0') || null;
            const taxaExtra = col(row, 'Taxa Extra', 'TAXA_EXTRA', 'TaxaExtra') || null;
            const chargeBaseKey = getChargeImportKey({ debtorImportKey, contrato, vencimento, esp, elemento, parcela: parcelaRaw || parcela, taxaExtra });
            const chargeImportKey = getNextOccurrenceKey(chargeOccurrences, chargeBaseKey);
            const dateKey = vencimento.toISOString().slice(0,10);
            const fbKey   = String(lead._id) + '|' + (contrato || '') + '|' + dateKey + '|' + (esp||'') + '|' + (elemento||'') + '|' + (parcela||'');

            const updateFields = {
              importBatch, arquivoOrigem,
              cliente: clienteNome,
              empreendimento: col(row, 'Empreendimento', 'EMPREENDIMENTO', 'Empresa'),
              torre: col(row, 'Torre', 'TORRE'),
              apto:  col(row, 'Apto', 'APTO'),
              esp, elemento, taxaExtra,
              rf:    col(row, 'R/F', 'RF'),
              rg:    col(row, 'RG', 'Rg'),
              profissao: col(row, 'Profissao', 'PROFISSAO'),
              cpfCnpj,
              telefone1: col(row, 'Telefone 1', 'TELEFONE1', 'Telefone', 'Celular', 'TELEFONE 1'),
              telefone2: col(row, 'Telefone 2', 'TELEFONE2', 'TELEFONE 2', 'Contato Novo'),
              parcela, debtorImportKey,
              importStatus: rowImportStatus, lastSeenBatch: importBatch, exitedInBatch: null,
              atraso:    parseInt(col(row, 'Atraso', 'ATRASO', 'Atraso (dias)') || '0') || 0,
              principal: parseDecimal(col(row, 'Principal', 'PRINCIPAL')),
              juros:     parseDecimal(col(row, 'Juros', 'Juros de Mora', 'JUROS')),
              multa:     parseDecimal(col(row, 'Multa', 'MULTA')),
              total:     parseDecimal(col(row, 'Total', 'TOTAL', 'Valor')),
            };

            const existingDebt = debtByChargeKey.get(chargeImportKey)
                              || debtByChargeKey.get(chargeBaseKey)
                              || debtByFallback.get(fbKey);

            if (existingDebt) {
              const setFields = Object.assign({}, updateFields);
              if (!existingDebt.chargeImportKey) setFields.chargeImportKey = chargeImportKey;
              debtBulkOps.push({
                updateOne: {
                  filter: { _id: existingDebt._id },
                  update: { $set: setFields }
                }
              });
              if (!existingDebt.chargeImportKey) debtByChargeKey.set(chargeImportKey, existingDebt);
              updated++;
            } else if (!seenChargeKeys.has(chargeImportKey)) {
              seenChargeKeys.add(chargeImportKey);
              debtBulkOps.push({
                insertOne: {
                  document: Object.assign({
                    _id: new ObjectId(),
                    user: new ObjectId(userId),
                    lead: lead._id,
                    contrato: contrato || '',
                    vencimento, esp, elemento, parcela, taxaExtra,
                    chargeImportKey,
                    firstSeenBatch: importBatch,
                    tags: rowImportStatus === 'novo' ? ['novo'] : []
                  }, updateFields)
                }
              });
              const newDoc = { chargeImportKey, lead: lead._id, contrato: contrato||'', vencimento, esp, elemento, parcela };
              debtByChargeKey.set(chargeImportKey, newDoc);
              debtByFallback.set(fbKey, newDoc);
              created++;
            } else {
              skippedDuplicates++;
            }
          } catch (e) {
            logger.error('[Generic Import] Erro na linha ' + (i + 1) + ': ' + e.message);
            errors++;
          }

          if ((i + 1) % 100 === 0 || i === records.length - 1) {
            const pct = Math.round(10 + ((i + 1) / records.length) * 80);
            if (io) io.emit('spreadsheet-progress', { percent: pct, current: i + 1, total: records.length, status: 'extraindo' });
          }
        }

        if (io) io.emit('spreadsheet-progress', { percent: 90, current: records.length, total: records.length, status: 'extraindo' });

        // ── PASSO 4: Persiste em batch ──────────────────────────────────────────────────
        if (leadsToCreate.length > 0) {
          try { await Lead.insertMany(leadsToCreate, { ordered: false }); }
          catch (e) { if (e.code !== 11000) throw e; }
        }

        const BATCH = 500;
        for (let b = 0; b < debtBulkOps.length; b += BATCH) {
          await InadimplenciaDetalhe.bulkWrite(debtBulkOps.slice(b, b + BATCH), { ordered: false });
        }

        // ── PASSO 5: Marca devedores que saíram ────────────────────────────────────────
        for (const [key, previous] of previousDebtors.entries()) {
          if (currentDebtorKeys.has(key)) continue;
          const leadIds = [...previous.leadIds].map(id => new ObjectId(id));
          const exitQuery = {
            user: new ObjectId(userId), status: { $ne: 'pago' }, importStatus: { $ne: 'saiu' },
            ...(leadIds.length ? { lead: { $in: leadIds } } : { debtorImportKey: key })
          };
          const exitResult = await InadimplenciaDetalhe.updateMany(exitQuery, {
            $set: { importStatus: 'saiu', exitedInBatch: importBatch, debtorImportKey: key },
            $addToSet: { tags: 'saiu' }
          });
          if (exitResult.modifiedCount > 0) exitedDebtors++;
        }

        newDebtors = [...currentDebtorKeys].filter(k => !previousDebtors.has(k)).length;

        const totalImportado = await InadimplenciaDetalhe.aggregate([
          { $match: { user: new ObjectId(userId), importBatch } },
          { $group: { _id: null, soma: { $sum: '$total' }, count: { $sum: 1 } } }
        ]);
        const somaImportada = totalImportado[0] ? totalImportado[0].soma : 0;
        const countImportado = totalImportado[0] ? totalImportado[0].count : 0;

        logger.info('[importGeneric] DONE: created=' + created + ' updated=' + updated + ' errors=' + errors + ' soma=R$' + somaImportada.toFixed(2) + ' count=' + countImportado + ' leads_novos=' + leadsToCreate.length);
        if (io) io.emit('spreadsheet-progress', { percent: 100, status: 'finalizado' });
        if (io) io.emit('spreadsheet-done', {
          success: true, importBatch, created, updated, errors,
          total: records.length, newDebtors, exitedDebtors, skippedDuplicates,
          somaImportada: parseFloat(somaImportada.toFixed(2)), countImportado
        });
      } catch (e) {
        logger.error('[importGeneric] Erro critico no background: ' + e.message);
        if (io) io.emit('spreadsheet-done', { success: false, error: e.message });
      } finally {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      }
    });
  }

  // ── 4. Listar registros agrupados por mês ────────────────────────────────────
  async getByMonth(req, res) {
    try {
      const userId = req.user.id;
      const { tipo = 'inadimplencia', ano, empreendimento } = req.query;

      let Model, dateField;
      if (tipo === 'spc') {
        Model = SpcRecord; dateField = 'dataVencimento';
      } else if (tipo === 'contas-receber') {
        Model = ContasReceber; dateField = 'vencimento';
      } else {
        Model = InadimplenciaDetalhe; dateField = 'vencimento';
      }

      const matchStage = { user: { $oid: userId } };
      if (empreendimento) matchStage.empreendimento = { $regex: empreendimento, $options: 'i' };

      const pipeline = [
        { $match: { user: new (require('mongoose').Types.ObjectId)(userId), ...(empreendimento ? { empreendimento: new RegExp(empreendimento, 'i') } : {}) } },
        ...(ano ? [{ $match: { [dateField]: { $gte: new Date(`${ano}-01-01`), $lt: new Date(`${parseInt(ano) + 1}-01-01`) } } }] : []),
        {
          $group: {
            _id: {
              ano: { $year: `$${dateField}` },
              mes: { $month: `$${dateField}` },
            },
            totalRegistros: { $sum: 1 },
            totalValor:     { $sum: tipo === 'spc' ? '$valorSpc' : '$total' },
            totalPrincipal: { $sum: '$principal' },
            totalJuros:     { $sum: '$juros' },
            totalMulta:     { $sum: '$multa' },
            registros:      { $push: '$$ROOT' },
          }
        },
        { $sort: { '_id.ano': -1, '_id.mes': -1 } },
        {
          $project: {
            _id: 0,
            ano: '$_id.ano',
            mes: '$_id.mes',
            totalRegistros: 1,
            totalValor: 1,
            totalPrincipal: 1,
            totalJuros: 1,
            totalMulta: 1,
            registros: 1,
          }
        }
      ];

      const result = await Model.aggregate(pipeline);
      res.json(result);
    } catch (e) {
      logger.error('[getByMonth] Erro:', e);
      res.status(500).json({ message: e.message });
    }
  }
  
  // â”€â”€ 4b. Listar Devedores agrupados por Lead (Consolidado) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getDebtorsSummary(req, res) {
    try {
      const userId = req.user.id;
      const uid = new (require('mongoose').Types.ObjectId)(userId);
      const today = new Date();

      const pipeline = [
        { $match: { user: uid, status: { $ne: 'pago' } } },
        { $sort: { updatedAt: -1 } },
        {
          $group: {
            _id: "$lead",
            cliente: { $first: "$cliente" },
            cpfCnpj: { $first: "$cpfCnpj" },
            empreendimento: { $first: "$empreendimento" },
            contrato: { $first: "$contrato" },
            telefone1: { $first: "$telefone1" },
            telefone2: { $first: "$telefone2" },
            importStatus: { $first: "$importStatus" },
            lastSeenBatch: { $first: "$lastSeenBatch" },
            exitedInBatch: { $first: "$exitedInBatch" },
            totalGeral: { $sum: "$total" },
            totalPrincipalGeral: { $sum: "$principal" },
            totalVencido: {
              $sum: {
                $cond: [{ $lte: ["$vencimento", today] }, "$total", 0]
              }
            },
            totalFuturo: {
              $sum: {
                $cond: [{ $gt: ["$vencimento", today] }, "$total", 0]
              }
            },
            qtdVencidas: {
              $sum: {
                $cond: [{ $lte: ["$vencimento", today] }, 1, 0]
              }
            },
            qtdFuturas: {
              $sum: {
                $cond: [{ $gt: ["$vencimento", today] }, 1, 0]
              }
            },
            charges: { $push: "$$ROOT" }
          }
        },
        // Populate Lead status (O lead é criado no importGeneric)
        {
          $lookup: {
            from: 'leads',
            localField: '_id',
            foreignField: '_id',
            as: 'leadInfo'
          }
        },
        { $unwind: { path: "$leadInfo", preserveNullAndEmptyArrays: true } },
        {
          $project: {
            _id: 1,
            cliente: 1,
            cpfCnpj: 1,
            empreendimento: 1,
            contrato: 1,
            telefone1: 1,
            telefone2: 1,
            importStatus: { $ifNull: ["$importStatus", "mantido"] },
            lastSeenBatch: 1,
            exitedInBatch: 1,
            totalGeral: 1,
            totalPrincipalGeral: 1,
            totalVencido: 1,
            totalFuturo: 1,
            qtdVencidas: 1,
            qtdFuturas: 1,
            charges: 1,
            status: "$leadInfo.status",
            manualReportStatus: "$leadInfo.manualReportStatus",
            tags: "$leadInfo.tags",
            contacts: "$leadInfo.contacts"
          }
        },
        { $sort: { importStatus: 1, totalVencido: -1 } }
      ];

      const result = await InadimplenciaDetalhe.aggregate(pipeline);
      res.json(result);
    } catch (e) {
      logger.error('[getDebtorsSummary] Erro:', e);
      res.status(500).json({ message: e.message });
    }
  }

  // â”€â”€ 5. Listar batches de importação â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async getImportBatches(req, res) {
    try {
      const userId = req.user.id;
      const uid = new (require('mongoose').Types.ObjectId)(userId);

      const [spc, cr, ina] = await Promise.all([
        SpcRecord.distinct('importBatch', { user: uid }),
        ContasReceber.distinct('importBatch', { user: uid }),
        InadimplenciaDetalhe.distinct('importBatch', { user: uid }),
      ]);

      res.json({ spc, contasReceber: cr, inadimplencia: ina });
    } catch (e) {
      logger.error('[getImportBatches] Erro:', e);
      res.status(500).json({ message: e.message });
    }
  }

  // â”€â”€ 5. Limpar Base de Dados do Usuário â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async updateDebtorReportStatus(req, res) {
    try {
      const userId = req.user.id;
      const { leadId } = req.params;
      const manualReportStatus = String(req.body.manualReportStatus || '').trim();

      const lead = await Lead.findOneAndUpdate(
        { _id: leadId, user: userId },
        { $set: { manualReportStatus } },
        { new: true }
      ).select('_id manualReportStatus');

      if (!lead) return res.status(404).json({ message: 'Devedor nao encontrado.' });
      res.json({ success: true, lead });
    } catch (e) {
      logger.error('[updateDebtorReportStatus] Erro:', e);
      res.status(500).json({ message: e.message });
    }
  }

  async clearData(req, res) {
    try {
      const userId = req.user.id;
      const mongoose = require('mongoose');
      const uid = new mongoose.Types.ObjectId(userId);
      // Importações dinâmicas para evitar dependência circular se necessário
      const Lead = require('../../utils/modelProvider').getModel('Lead');
      const InadimplenciaDetalhe = require('../../utils/modelProvider').getModel('InadimplenciaDetalhe');
      const Debt = require('../../utils/modelProvider').getModel('Debt');
      const Installment = require('../../utils/modelProvider').getModel('Installment');
      const Guarantor = require('../../utils/modelProvider').getModel('Guarantor');
      
      logger.info(`[Spreadsheet] Limpando base de dados para usuário: ${userId}`);
      console.log(`--- [BACKEND] Limpando base para: ${userId} ---`);
      
      const [inadimplenciaLeadIds, contasLeadIds, spcLeadIds, debtDocs] = await Promise.all([
        InadimplenciaDetalhe.distinct('lead', { user: uid, lead: { $ne: null } }),
        ContasReceber.distinct('lead', { user: uid, lead: { $ne: null } }),
        SpcRecord.distinct('lead', { user: uid, lead: { $ne: null } }),
        Debt.find({ user: uid }).select('_id lead').lean()
      ]);

      const debtIds = debtDocs.map((debt) => debt._id);
      const debtLeadIds = debtDocs.map((debt) => debt.lead).filter(Boolean);
      const importedLeadIds = [
        ...new Set([
          ...inadimplenciaLeadIds,
          ...contasLeadIds,
          ...spcLeadIds,
          ...debtLeadIds
        ].filter(Boolean).map(String))
      ].map((id) => new mongoose.Types.ObjectId(id));

      const [
        resInstallmentsByDebt,
        resInstallmentsByUser,
        resGuarantorsByDebt,
        resGuarantorsByUser,
        resDebt,
        resInadimplencia,
        resContasReceber,
        resSpc
      ] = await Promise.all([
        debtIds.length ? Installment.deleteMany({ debt: { $in: debtIds } }) : Promise.resolve({ deletedCount: 0 }),
        Installment.deleteMany({ user: uid }),
        debtIds.length ? Guarantor.deleteMany({ debt: { $in: debtIds } }) : Promise.resolve({ deletedCount: 0 }),
        Guarantor.deleteMany({ user: uid }),
        Debt.deleteMany({ user: uid }),
        InadimplenciaDetalhe.deleteMany({ user: uid }),
        ContasReceber.deleteMany({ user: uid }),
        SpcRecord.deleteMany({ user: uid })
      ]);

      const resImportedLeads = importedLeadIds.length
        ? await Lead.deleteMany({ _id: { $in: importedLeadIds }, user: uid })
        : { deletedCount: 0 };

      const resOrphanImportedLeads = await Lead.deleteMany({
        user: uid,
        email: /@importado\.local$/i
      });

      const count = {
        leads: resImportedLeads.deletedCount + resOrphanImportedLeads.deletedCount,
        inadimplencia: resInadimplencia.deletedCount,
        contasReceber: resContasReceber.deletedCount,
        spc: resSpc.deletedCount,
        debts: resDebt.deletedCount,
        installments: resInstallmentsByDebt.deletedCount + resInstallmentsByUser.deletedCount,
        guarantors: resGuarantorsByDebt.deletedCount + resGuarantorsByUser.deletedCount
      };

      logger.info('[Spreadsheet] Base de cobranca limpa:', count);
      console.log('--- [BACKEND] Limpeza concluida:', count);
      
      res.json({
        success: true,
        message: 'Base de cobranca limpa com sucesso.',
        count
      });
    } catch (error) {
      logger.error('[Spreadsheet] Erro ao limpar base:', error);
      res.status(500).json({ message: 'Erro ao limpar base de dados.' });
    }
  }

  // â”€â”€ 6. Exportar Relatório de Devedores para PDF â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  async exportDebtorsReport(req, res) {
    try {
      const PDFDocument = require('pdfkit');
      const userId = req.user.id;
      const type = req.query.type || 'ultimo'; // 'ultimo' ou 'completo'
      const leadId = req.query.leadId; 
      const uid = new (require('mongoose').Types.ObjectId)(userId);
      const Conversation = require('../../utils/modelProvider').getModel('Conversation');
      const InadimplenciaDetalhe = require('../../utils/modelProvider').getModel('InadimplenciaDetalhe');
      const Installment = require('../../utils/modelProvider').getModel('Installment');
      const Debt = require('../../utils/modelProvider').getModel('Debt');
      const { format } = require('date-fns');

      const matchStage = { user: uid, ...(type === 'listagem' ? { status: { $ne: 'pago' } } : {}) };
      if (leadId) matchStage.lead = new (require('mongoose').Types.ObjectId)(leadId);

      const debtors = await InadimplenciaDetalhe.aggregate([
        { $match: matchStage },
        { $sort: { updatedAt: -1 } },
        {
          $group: {
            _id: "$lead",
            cliente: { $first: "$cliente" },
            cpfCnpj: { $first: "$cpfCnpj" },
            empreendimento: { $first: "$empreendimento" },
            telefone1: { $first: "$telefone1" },
            telefone2: { $first: "$telefone2" },
            importStatus: { $first: "$importStatus" },
            lastSeenBatch: { $first: "$lastSeenBatch" },
            exitedInBatch: { $first: "$exitedInBatch" },
            totalPrincipal: { $sum: "$principal" },
            totalGeral: { $sum: "$total" }
          }
        },
        { $lookup: { from: 'leads', localField: '_id', foreignField: '_id', as: 'leadInfo' } },
        { $unwind: { path: "$leadInfo", preserveNullAndEmptyArrays: true } }
      ]);

      if (!debtors.length) return res.status(404).json({ message: 'Nenhum dado encontrado.' });

      const doc = new PDFDocument({ margin: 50, size: 'A4' });
      const filename = `Relatorio_Cobranca_${Date.now()}.pdf`;

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      doc.pipe(res);

      // --- Estilos e Cores ---
      const primaryColor = '#6366f1';
      const secondaryColor = '#475569';
      const accentColor = '#ef4444';

      // --- Cabeçalho ---
      doc.fillColor(primaryColor).fontSize(24).font('Helvetica-Bold').text('QualifAI - Relatório de Cobrança', { align: 'center' });
      doc.fillColor(secondaryColor).fontSize(10).font('Helvetica').text(`Gerado em: ${format(new Date(), 'dd/mm/yyyy HH:mm:ss')}`, { align: 'center' });
      doc.moveDown(2);

      if (type === 'listagem') {
        const fmtPhone = (phone) => {
          const clean = String(phone || '').replace(/\D/g, '');
          if (!clean) return '-';
          if (clean.length === 13 && clean.startsWith('55')) return `(${clean.slice(2, 4)}) ${clean.slice(4, 9)}-${clean.slice(9)}`;
          if (clean.length === 11) return `(${clean.slice(0, 2)}) ${clean.slice(2, 7)}-${clean.slice(7)}`;
          if (clean.length === 10) return `(${clean.slice(0, 2)}) ${clean.slice(2, 6)}-${clean.slice(6)}`;
          return clean;
        };

        doc.fillColor('#000000').fontSize(13).font('Helvetica-Bold').text('Listagem para impressao - um devedor por linha');
        doc.fillColor(secondaryColor).fontSize(9).font('Helvetica').text('Inclui status manual e movimento calculado pela comparacao da ultima importacao com a base anterior.');
        doc.moveDown(1);

        const columns = [
          { title: 'Nome', x: 50, width: 170 },
          { title: 'Telefone', x: 220, width: 92 },
          { title: 'Status manual', x: 312, width: 115 },
          { title: 'Movimento', x: 427, width: 88 },
          { title: 'Total', x: 515, width: 70 }
        ];
        const drawHeader = () => {
          const y = doc.y;
          doc.rect(45, y, 510, 18).fill('#eef2ff');
          columns.forEach((c) => doc.fillColor(primaryColor).fontSize(8).font('Helvetica-Bold').text(c.title, c.x, y + 5, { width: c.width }));
          doc.y = y + 23;
        };

        drawHeader();
        debtors.forEach((d, index) => {
          if (doc.y > 760) {
            doc.addPage();
            drawHeader();
          }
          const y = doc.y;
          if (index % 2 === 0) doc.rect(45, y - 2, 510, 18).fill('#f8fafc');
          const reportStatus = d.leadInfo?.manualReportStatus || d.leadInfo?.status || '-';
          const phone = d.telefone1 || d.telefone2 || d.leadInfo?.phone;
          const movement = formatImportStatus(d.importStatus);
          const total = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(d.totalGeral || 0);
          doc.fillColor('#111827').fontSize(8).font('Helvetica').text(d.cliente || '-', columns[0].x, y, { width: columns[0].width, ellipsis: true });
          doc.text(fmtPhone(phone), columns[1].x, y, { width: columns[1].width });
          doc.text(reportStatus, columns[2].x, y, { width: columns[2].width, ellipsis: true });
          doc.text(movement, columns[3].x, y, { width: columns[3].width, ellipsis: true });
          doc.text(total, columns[4].x, y, { width: columns[4].width, align: 'right' });
          doc.y = y + 18;
        });

        doc.end();
        return;
      }

      for (const d of debtors) {
        // Bloco do Devedor
        doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text('DADOS DO DEVEDOR', { underline: true });
        doc.moveDown(0.5);
        
        doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold').text(`Nome: `, { continued: true }).font('Helvetica').text(d.cliente || 'â€”');
        doc.font('Helvetica-Bold').text(`CPF/CNPJ: `, { continued: true }).font('Helvetica').text(d.cpfCnpj || 'â€”');
        doc.font('Helvetica-Bold').text(`Empreendimento: `, { continued: true }).font('Helvetica').text(d.empreendimento || 'â€”');
        doc.font('Helvetica-Bold').text(`Status Atual: `, { continued: true }).font('Helvetica').text((d.leadInfo?.status || 'novo').toUpperCase());
        doc.font('Helvetica-Bold').text(`Status Manual: `, { continued: true }).font('Helvetica').text(d.leadInfo?.manualReportStatus || '---');
        doc.font('Helvetica-Bold').text(`Movimento Importacao: `, { continued: true }).font('Helvetica').text(formatImportStatus(d.importStatus));
        doc.moveDown(0.5);

        // Financeiro
        const formatMoney = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);

        doc.rect(doc.x, doc.y, 500, 45).fill('#f8fafc').stroke('#e2e8f0');
        doc.fillColor('#000000').fontSize(10).font('Helvetica-Bold').text('RESUMO FINANCEIRO', doc.x + 10, doc.y + 10);
        doc.font('Helvetica').text(`Total Principal: ${formatMoney(d.totalPrincipal)}  |  Total Corrigido: ${formatMoney(d.totalGeral)}`, doc.x, doc.y + 5);
        doc.moveDown(2.5);

        // Histórico
        doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('HISTÃ“RICO DE AÃ‡Ã•ES');
        doc.moveTo(doc.x, doc.y).lineTo(550, doc.y).stroke(primaryColor);
        doc.moveDown(0.8);

        const conversas = await Conversation.find({ lead: d._id }).sort({ createdAt: 1 }).lean();
        let mensagens = [];
        conversas.forEach(conv => {
          if (conv.messages) {
            mensagens.push(...conv.messages.map(m => ({ date: m.timestamp, role: m.role, content: m.content })));
          }
        });

        // Helper para formatar moeda no PDF
        const pdfFmt = (val) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0);
        
        // Helper para traduzir método de pagamento
        const translateMethod = (m) => {
          const map = { 'transfer': 'Transferência', 'pix': 'PIX', 'boleto': 'Boleto', 'card': 'Cartão', 'cash': 'Dinheiro' };
          return map[m] || 'Sistema';
        };

        // Buscar pagamentos (Unificado)
        let payments = [];
        
        // 1. Pagamentos de Parcelas
        const debt = await Debt.findOne({ lead: d._id });
        if (debt) {
          const installmentPayments = await Installment.find({ debt: debt._id, status: 'pago' }).lean();
          payments.push(...installmentPayments.map(p => ({
            date: p.paidAt,
            role: 'payment',
            content: `PAGAMENTO CONFIRMADO: ${pdfFmt(p.paidAmount)} (Parcela ${p.number}) via ${translateMethod(p.paymentMethod)}`
          })));
        }

        // 2. Pagamentos de registros de planilhas
        const spreadsheetPayments = await InadimplenciaDetalhe.find({ lead: d._id, status: 'pago' }).lean();
        payments.push(...spreadsheetPayments.map(p => ({
          date: p.paidAt,
          role: 'payment',
          content: `PAGAMENTO CONFIRMADO: ${pdfFmt(p.paidAmount)} (Importado) via ${translateMethod(p.paymentMethod)}`
        })));

        let events = [...mensagens, ...payments];

        if (events.length > 0) {
          events.sort((a,b) => new Date(a.date) - new Date(b.date));
          
          const aProcessar = type === 'ultimo' ? [events[events.length-1]] : events;
          
          aProcessar.forEach(m => {
            const dataStr = m.date ? format(new Date(m.date), 'dd/MM HH:mm:ss') : 'â€”';
            let roleStr = '';
            let textColor = '#334155';
            let labelColor = secondaryColor;

            if (m.role === 'ai') roleStr = 'IA';
            else if (m.role === 'human') roleStr = 'HUMANO';
            else if (m.role === 'customer') roleStr = 'CLIENTE';
            else if (m.role === 'payment') {
              roleStr = 'FINANCEIRO';
              labelColor = '#10b981'; // Verde para pagamentos
              textColor = '#065f46';
            } else {
              roleStr = 'SISTEMA';
            }
            
            doc.fillColor(labelColor).fontSize(9).font('Helvetica-Bold').text(`[${dataStr}] ${roleStr}: `, { continued: true });
            doc.fillColor(textColor).font('Helvetica').text(m.content);
            doc.moveDown(0.3);
          });
        } else {
          doc.fillColor('#94a3b8').fontSize(10).font('Helvetica-Oblique').text('Nenhuma interação registrada até o momento.');
        }

        doc.moveDown(2);
        if (debtors.indexOf(d) < debtors.length - 1) doc.addPage();
      }

      doc.end();
    } catch (error) {
      logger.error('[Spreadsheet] Erro ao exportar devedores (PDF):', error);
      if (!res.headersSent) res.status(500).json({ message: 'Erro ao gerar PDF.' });
    }
  }

  // â”€â”€ 7. Diagnóstico de Duplicatas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * GET /spreadsheets/diagnose-duplicates
   * Retorna grupos de registros duplicados para o usuário autenticado.
   * Duplicata: mesmo lead + contrato + dia de vencimento com mais de 1 registro não pago.
   */
  async diagnoseDuplicates(req, res) {
    try {
      const userId = req.user.id;
      const uid = new (require('mongoose').Types.ObjectId)(userId);

      const duplicates = await InadimplenciaDetalhe.aggregate([
        { $match: { user: uid, status: { $ne: 'pago' } } },
        {
          $group: {
            _id: {
              lead: '$lead',
              contrato: '$contrato',
              ano:  { $year:  '$vencimento' },
              mes:  { $month: '$vencimento' },
              dia:  { $dayOfMonth: '$vencimento' }
            },
            ids:          { $push: '$_id' },
            batches:      { $push: '$importBatch' },
            chargeKeys:   { $push: '$chargeImportKey' },
            totals:       { $push: '$total' },
            clientes:     { $addToSet: '$cliente' },
            importStatuses: { $addToSet: '$importStatus' },
            updatedAts:   { $push: '$updatedAt' },
            count:        { $sum: 1 }
          }
        },
        { $match: { count: { $gt: 1 } } },
        { $sort: { count: -1 } }
      ]);

      const totalDuplicateRecords = duplicates.reduce((acc, g) => acc + g.count - 1, 0);

      res.json({
        groups: duplicates.length,
        totalDuplicateRecords,
        details: duplicates.map(g => ({
          cliente: g.clientes.join('/'),
          contrato: g._id.contrato,
          vencimento: `${g._id.dia}/${g._id.mes}/${g._id.ano}`,
          count: g.count,
          totalSomado: g.totals.reduce((a, b) => a + (b || 0), 0),
          ids: g.ids,
          batches: g.batches,
          chargeKeys: g.chargeKeys,
          importStatuses: g.importStatuses
        }))
      });
    } catch (e) {
      logger.error('[diagnoseDuplicates] Erro:', e);
      res.status(500).json({ message: e.message });
    }
  }

  // â”€â”€ 8. Correção de Duplicatas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  /**
   * POST /spreadsheets/fix-duplicates
   * Remove registros duplicados, mantendo o mais recente (por updatedAt) em cada grupo.
   * Retorna quantos registros foram removidos.
   */
  async fixDuplicates(req, res) {
    try {
      const userId = req.user.id;
      const uid = new (require('mongoose').Types.ObjectId)(userId);

      const duplicates = await InadimplenciaDetalhe.aggregate([
        { $match: { user: uid, status: { $ne: 'pago' } } },
        {
          $group: {
            _id: {
              lead: '$lead',
              contrato: '$contrato',
              ano:  { $year:  '$vencimento' },
              mes:  { $month: '$vencimento' },
              dia:  { $dayOfMonth: '$vencimento' }
            },
            ids:        { $push: '$_id' },
            updatedAts: { $push: '$updatedAt' },
            count:      { $sum: 1 }
          }
        },
        { $match: { count: { $gt: 1 } } }
      ]);

      const idsToRemove = [];

      for (const group of duplicates) {
        // Ordena do mais recente para o mais antigo
        const entries = group.ids.map((id, i) => ({ id, updatedAt: group.updatedAts[i] || new Date(0) }));
        entries.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
        // Mantém o primeiro (mais recente), remove os demais
        entries.slice(1).forEach(e => idsToRemove.push(e.id));
      }

      if (!idsToRemove.length) {
        return res.json({ success: true, removed: 0, message: 'Nenhuma duplicata encontrada.' });
      }

      const result = await InadimplenciaDetalhe.deleteMany({ _id: { $in: idsToRemove } });

      logger.info(`[fixDuplicates] Removidas ${result.deletedCount} duplicatas para usuário ${userId}`);
      res.json({
        success: true,
        removed: result.deletedCount,
        groups: duplicates.length,
        message: `${result.deletedCount} registros duplicados removidos. Os mais recentes foram mantidos.`
      });
    } catch (e) {
      logger.error('[fixDuplicates] Erro:', e);
      res.status(500).json({ message: e.message });
    }
  }
}

module.exports = new SpreadsheetController();

