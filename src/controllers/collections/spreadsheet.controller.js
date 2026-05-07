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

// ─── Helpers ──────────────────────────────────────────────────────────────────

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
      if (val !== undefined && val !== null && val !== '') return String(val).trim();
    }
  }
  return null;
};

/** Converte string de data para Date (suporta dd/mm/yyyy e yyyy-mm-dd) */
const parseDate = (val) => {
  if (!val) return null;
  if (val instanceof Date) return val; // Já é um objeto Date
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
    
    // Fallback agressivo caso ainda dê conflito de e-mail (ex: race condition)
    if (e.message.includes('E11000')) {
       return await Lead.findOne({ user: userId, email: (email || '').toLowerCase() });
    }
    return null;
  }
};

// ─── Controller ───────────────────────────────────────────────────────────────

class SpreadsheetController {

  // ── Importação Genérica de Planilha de Cobrança (UPSERT) ───────────────────
  async importGeneric(req, res) {
    if (!req.file) return res.status(400).json({ message: 'Arquivo é obrigatório.' });
    
    const userId = req.user.id;
    const filePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const arquivoOrigem = req.body.arquivoOrigem || req.file.originalname;
    const importBatch = `${new Date().toISOString().replace(/[:.]/g, '-')}_${req.file.originalname}`;

    try {
      const records = await readFileRecords(filePath, fileExt);
      console.log(`[Import] Arquivo lido. Total de linhas: ${records.length}`);
      if (!records.length) {
        return res.status(400).json({
          message: 'Nenhuma linha válida encontrada. Verifique se a planilha tem colunas Cliente, Vencimento, Principal e Total.'
        });
      }
      
      const io = req.app.get('io');
      const previousRows = await InadimplenciaDetalhe.find({
        user: userId,
        status: { $ne: 'pago' },
        importStatus: { $ne: 'saiu' }
      }).select('lead cpfCnpj cliente').lean();
      const previousDebtors = new Map();
      previousRows.forEach((row) => {
        const key = getDebtorImportKey({ cpfCnpj: row.cpfCnpj, cliente: row.cliente, lead: row.lead });
        if (!key) return;
        if (!previousDebtors.has(key)) previousDebtors.set(key, { leadIds: new Set(), cpfCnpj: row.cpfCnpj, cliente: row.cliente });
        if (row.lead) previousDebtors.get(key).leadIds.add(String(row.lead));
      });
      const currentDebtorKeys = new Set(records.map(getDebtorImportKeyFromRow).filter(Boolean));
      const importedChargeKeys = new Set();
      let created = 0, updated = 0, errors = 0, newDebtors = 0, exitedDebtors = 0, skippedDuplicates = 0;
      let lastPercent = 0;

      for (let i = 0; i < records.length; i++) {
        const row = records[i];
        try {
          // Emissão de progresso via Socket (a cada 5% ou a cada 10 registros)
          const currentPercent = Math.round(((i + 1) / records.length) * 100);
          if (currentPercent > lastPercent || (i + 1) % 10 === 0) {
            lastPercent = currentPercent;
            if (io) {
              io.emit('spreadsheet-progress', {
                percent: currentPercent,
                current: i + 1,
                total: records.length,
                status: 'extraindo'
              });
            }
          }
          const cpfCnpj  = col(row, 'CPF/CNPJ', 'CPF', 'CNPJ', 'cpfCnpj', 'Documento');
          const clienteNome = col(row, 'Cliente', 'CLIENTE', 'NOME', 'Razão', 'Razao', 'Nome do Cliente');
          const contrato = col(row, 'Contrato', 'CONTRATO', 'Número do Contrato');
          const vencimentoRaw = col(row, 'Vencimento', 'VENCIMENTO', 'DATA_VENCIMENTO', 'Data do Vencimento');
          const vencimento = parseDate(vencimentoRaw);

          if (!clienteNome && !cpfCnpj) {
            errors++;
            continue; // Ignora linha inválida
          }

          const debtorImportKey = getDebtorImportKey({ cpfCnpj, cliente: clienteNome });
          const rowImportStatus = previousDebtors.has(debtorImportKey) ? 'mantido' : 'novo';

          const lead = await findOrCreateLead(userId, {
            cpfCnpj,
            nome: clienteNome,
            email: col(row, 'E-mail', 'Email', 'EMAIL'),
            telefone: col(row, 'Telefone 1', 'TELEFONE1', 'Telefone', 'Celular', 'TELEFONE 1'),
            telefone2: col(row, 'Telefone 2', 'TELEFONE2', 'TELEFONE 2', 'Contato Novo'),
            empresa:  col(row, 'Empreendimento', 'EMPREENDIMENTO', 'Empresa'),
          });

          const esp = col(row, 'Esp', 'ESP') || null;
          const elemento = col(row, 'Elemento', 'ELEMENTO') || null;
          const parcela = parseInt(col(row, 'Parcela', 'PARCELA') || '0') || null;
          const taxaExtra = col(row, 'Taxa Extra', 'TAXA_EXTRA', 'TaxaExtra') || null;
          const chargeImportKey = getChargeImportKey({ debtorImportKey, contrato, vencimento, esp, elemento, parcela, taxaExtra });

          if (!vencimento) {
            console.warn(`[Import] Linha ${i + 1} sem data de vencimento vÃ¡lida.`);
            errors++;
            continue;
          }

          if (importedChargeKeys.has(chargeImportKey)) {
            skippedDuplicates++;
            continue;
          }
          importedChargeKeys.add(chargeImportKey);

          const matchQuery = {
            user: userId,
            lead: lead?._id,
            contrato: contrato || '',
            vencimento,
            esp,
            elemento,
            parcela,
            taxaExtra
          };

          const updateData = {
            importBatch,
            arquivoOrigem,
            cliente:             clienteNome,
            empreendimento:      col(row, 'Empreendimento', 'EMPREENDIMENTO', 'Empresa'),
            torre:               col(row, 'Torre', 'TORRE'),
            apto:                col(row, 'Apto', 'APTO'),
            esp,
            elemento,
            taxaExtra,
            rf:                  col(row, 'R/F', 'RF'),
            rg:                  col(row, 'RG', 'Rg'),
            profissao:           col(row, 'Profissão', 'Profissao', 'PROFISSAO'),
            cpfCnpj,
            telefone1:           col(row, 'Telefone 1', 'TELEFONE1', 'Telefone', 'Celular', 'TELEFONE 1'),
            telefone2:           col(row, 'Telefone 2', 'TELEFONE2', 'TELEFONE 2', 'Contato Novo'),
            parcela,
            debtorImportKey,
            chargeImportKey,
            importStatus: rowImportStatus,
            lastSeenBatch: importBatch,
            exitedInBatch: null,
            atraso:  parseInt(col(row, 'Atraso', 'ATRASO', 'Atraso (dias)') || '0') || 0,
            principal: parseDecimal(col(row, 'Principal', 'PRINCIPAL')),
            juros:     parseDecimal(col(row, 'Juros', 'Juros de Mora', 'JUROS')),
                        multa:     parseDecimal(col(row, 'Multa', 'MULTA')),
            total:     parseDecimal(col(row, 'Total', 'TOTAL', 'Valor')),
          };

          if (vencimento) {
            const { start, end } = getDateRange(vencimento);
            const existing = await InadimplenciaDetalhe.findOne({ user: userId, chargeImportKey })
              || await InadimplenciaDetalhe.findOne({
                ...matchQuery,
                vencimento: { $gte: start, $lt: end }
              });
            if (existing) {
                const previousFirstSeenBatch = existing.firstSeenBatch || existing.importBatch || importBatch;
                // Se for o MESMO batch de importação, nós SOMAMOS (para suportar múltiplas linhas do mesmo item na mesma planilha)
                // Se for um batch DIFERENTE (ex: re-importação), nós SOBRESCREVEMOS (para atualizar com a planilha mais recente)
                if (false && existing.importBatch === updateData.importBatch) {
                    existing.principal = (existing.principal || 0) + updateData.principal;
                    existing.juros     = (existing.juros || 0) + updateData.juros;
                    existing.multa     = (existing.multa || 0) + updateData.multa;
                    existing.total     = (existing.total || 0) + updateData.total;
                } else {
                    existing.principal = updateData.principal;
                    existing.juros     = updateData.juros;
                    existing.multa     = updateData.multa;
                    existing.total     = updateData.total;
                    
                    // Atualiza campos descritivos
                    existing.importBatch   = updateData.importBatch;
                    existing.arquivoOrigem = updateData.arquivoOrigem;
                    existing.atraso        = updateData.atraso;
                    existing.cliente       = updateData.cliente;
                    existing.empreendimento = updateData.empreendimento;
                    existing.torre         = updateData.torre;
                    existing.apto          = updateData.apto;
                    existing.rf            = updateData.rf;
                    existing.rg            = updateData.rg;
                    existing.profissao     = updateData.profissao;
                    existing.telefone1     = updateData.telefone1;
                    existing.telefone2     = updateData.telefone2;
                }

              existing.debtorImportKey = updateData.debtorImportKey;
              existing.chargeImportKey = updateData.chargeImportKey;
              existing.importStatus = updateData.importStatus;
              existing.lastSeenBatch = updateData.lastSeenBatch;
              existing.exitedInBatch = null;
              existing.firstSeenBatch = previousFirstSeenBatch;
              await existing.save();
              updated++;
            } else {
              await InadimplenciaDetalhe.create({ ...matchQuery, ...updateData, firstSeenBatch: importBatch, tags: rowImportStatus === 'novo' ? ['novo'] : [] });
              created++;
            }
          } else {
            console.warn(`[Import] Linha ${i + 1} sem data de vencimento válida.`);
            errors++;
          }
        } catch (e) {
          logger.error(`[Generic Import] Erro na linha ${i + 1}: ${e.message}`);
          errors++;
        }
      }

      const mongoose = require('mongoose');
      for (const [key, previous] of previousDebtors.entries()) {
        if (currentDebtorKeys.has(key)) continue;
        const leadIds = [...previous.leadIds].map((id) => new mongoose.Types.ObjectId(id));
        const exitQuery = {
          user: userId,
          status: { $ne: 'pago' },
          importStatus: { $ne: 'saiu' },
          ...(leadIds.length ? { lead: { $in: leadIds } } : { debtorImportKey: key })
        };
        const exitResult = await InadimplenciaDetalhe.updateMany(exitQuery, {
          $set: {
            importStatus: 'saiu',
            exitedInBatch: importBatch,
            debtorImportKey: key
          },
          $addToSet: { tags: 'saiu' }
        });
        if (exitResult.modifiedCount > 0) exitedDebtors++;
      }

      newDebtors = [...currentDebtorKeys].filter((key) => !previousDebtors.has(key)).length;

      // Finaliza progresso
      if (io) io.emit('spreadsheet-progress', { percent: 100, status: 'finalizado' });
      res.json({ success: true, importBatch, created, updated, errors, total: records.length, newDebtors, exitedDebtors, skippedDuplicates });
    } catch (e) {
      logger.error('[importGeneric] Erro crítico:', e);
      res.status(500).json({ message: `Erro ao processar a planilha: ${e.message}` });
    } finally {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    }
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
  
  // ── 4b. Listar Devedores agrupados por Lead (Consolidado) ───────────────────
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
        { $unwind: "$leadInfo" },
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

  // ── 5. Listar batches de importação ──────────────────────────────────────────
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

  // ── 5. Limpar Base de Dados do Usuário ──────────────────────────────────────
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
      // Importações dinâmicas para evitar dependência circular se necessário
      const Lead = require('../../utils/modelProvider').getModel('Lead');
      const InadimplenciaDetalhe = require('../../utils/modelProvider').getModel('InadimplenciaDetalhe');
      
      logger.info(`[Spreadsheet] Limpando base de dados para usuário: ${userId}`);
      console.log(`--- [BACKEND] Limpando base para: ${userId} ---`);
      
      const resLeads = await Lead.deleteMany({ user: userId });
      console.log(`--- [BACKEND] Leads deletados: ${resLeads.deletedCount}`);
      const resDebts = await InadimplenciaDetalhe.deleteMany({ user: userId });
      console.log(`--- [BACKEND] Dívidas deletadas: ${resDebts.deletedCount}`);
      
      res.json({
        success: true,
        message: 'Base de dados limpa com sucesso.',
        count: {
          leads: resLeads.deletedCount,
          debts: resDebts.deletedCount
        }
      });
    } catch (error) {
      logger.error('[Spreadsheet] Erro ao limpar base:', error);
      res.status(500).json({ message: 'Erro ao limpar base de dados.' });
    }
  }

  // ── 6. Exportar Relatório de Devedores para PDF ──────────────────────────────
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
        
        doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold').text(`Nome: `, { continued: true }).font('Helvetica').text(d.cliente || '—');
        doc.font('Helvetica-Bold').text(`CPF/CNPJ: `, { continued: true }).font('Helvetica').text(d.cpfCnpj || '—');
        doc.font('Helvetica-Bold').text(`Empreendimento: `, { continued: true }).font('Helvetica').text(d.empreendimento || '—');
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
        doc.fillColor(primaryColor).fontSize(13).font('Helvetica-Bold').text('HISTÓRICO DE AÇÕES');
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
            const dataStr = m.date ? format(new Date(m.date), 'dd/MM HH:mm:ss') : '—';
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
}

module.exports = new SpreadsheetController();
