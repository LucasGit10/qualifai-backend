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
    const workbook = xlsx.readFile(filePath);
    let allRecords = [];
    
    // Percorre todas as abas da planilha
    workbook.SheetNames.forEach(sheetName => {
      const sheetRecords = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null });
      if (Array.isArray(sheetRecords)) {
        allRecords = allRecords.concat(sheetRecords);
      }
    });
    
    return allRecords;
  }
  throw new Error(`Formato não suportado: ${fileExt}`);
};

/** Normaliza nome de coluna para comparação robusta: remove espaços, acento e case */
const normalizeKey = (k) => k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s/g, '');

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
  let s = String(val).trim();
  
  // Se tem vírgula e ponto, assumimos ponto=milhar, vírgula=decimal (Brasil)
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    // Se só tem vírgula, trocamos por ponto para o parseFloat (ex: 10,00 -> 10.00)
    s = s.replace(',', '.');
  }
  
  // Remove tudo que não for dígito ou ponto ou sinal de menos
  const clean = s.replace(/[^\d.-]/g, '');
  const n = parseFloat(clean);
  return isNaN(n) ? 0 : n;
};

/** Busca ou cria um Lead pelo CPF/CNPJ ou e-mail de forma atômica/robusta */
const findOrCreateLead = async (userId, { cpfCnpj, nome, email, telefone, empresa }) => {
  try {
    const docNorm = cpfCnpj ? cpfCnpj.replace(/\D/g, '') : null;
    const generatedEmail = email ? email.toLowerCase() : (docNorm ? `${docNorm}@importado.local` : null);

    // Busca robusta: tenta por taxId (CPF/CNPJ) OU pelo e-mail gerado/fornecido
    let lead = await Lead.findOne({ 
      user: userId, 
      $or: [
        ...(docNorm ? [{ taxId: docNorm }] : []),
        ...(generatedEmail ? [{ email: generatedEmail }] : [])
      ]
    });

    if (!lead) {
      lead = new Lead({
        user: userId,
        name: nome || cpfCnpj || 'Devedor Importado',
        email: generatedEmail || `extra_${Date.now()}@importado.local`,
        taxId: docNorm,
        phone: telefone || null,
        company: empresa || 'Importado',
        source: 'form',
        status: 'novo',
      });
      await lead.save();
    } else {
      // Se encontrou mas estava sem telefone ou empresa, atualiza
      let multiUpdate = false;
      if (!lead.phone && telefone) { lead.phone = telefone; multiUpdate = true; }
      if (lead.company === 'Importado' && empresa) { lead.company = empresa; multiUpdate = true; }
      if (!lead.taxId && docNorm) { lead.taxId = docNorm; multiUpdate = true; }
      
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
    const importBatch = `${new Date().toISOString().slice(0, 10)}_${req.file.originalname}`;

    try {
      const records = await readFileRecords(filePath, fileExt);
      console.log(`[Import] Arquivo lido. Total de linhas: ${records.length}`);
      
      const io = req.app.get('io');
      let created = 0, updated = 0, errors = 0;
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

          // Busca ou Cria Lead
          const lead = await findOrCreateLead(userId, {
            cpfCnpj,
            nome: clienteNome,
            telefone: col(row, 'Telefone 1', 'TELEFONE1', 'Telefone', 'Celular'),
            empresa:  col(row, 'Empreendimento', 'EMPREENDIMENTO', 'Empresa'),
          });

          const esp = col(row, 'Esp', 'ESP') || null;
          const elemento = col(row, 'Elemento', 'ELEMENTO') || null;
          const parcela = parseInt(col(row, 'Parcela', 'PARCELA') || '0') || null;
          const taxaExtra = col(row, 'Taxa Extra', 'TAXA_EXTRA', 'TaxaExtra') || null;

          const matchQuery = {
            user: userId,
            lead: lead?._id,
            contrato: contrato || '',
            vencimento: vencimento,
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
            telefone1:           col(row, 'Telefone 1', 'TELEFONE1', 'Telefone', 'Celular'),
            parcela,
            atraso:  parseInt(col(row, 'Atraso', 'ATRASO', 'Atraso (dias)') || '0') || 0,
            principal: parseDecimal(col(row, 'Principal', 'PRINCIPAL')),
            juros:     parseDecimal(col(row, 'Juros', 'Juros de Mora', 'JUROS')),
            multa:     parseDecimal(col(row, 'Multa', 'MULTA')),
            total:     parseDecimal(col(row, 'Total', 'TOTAL', 'Valor')),
          };

          // Evitar inserções de objetos vazios se a query de match vier nula, mas a planilha geralmente é robusta
          if (vencimento) {
             const existing = await InadimplenciaDetalhe.findOne(matchQuery);
             if (existing) {
               // Acumula campos financeiros (linhas com mesma chave mas valores diferentes na planilha)
               existing.principal = (existing.principal || 0) + updateData.principal;
               existing.juros     = (existing.juros     || 0) + updateData.juros;
               existing.multa     = (existing.multa     || 0) + updateData.multa;
               existing.total     = (existing.total     || 0) + updateData.total;
               // Atualiza campos descritivos (não financeiros)
               existing.importBatch   = updateData.importBatch;
               existing.arquivoOrigem = updateData.arquivoOrigem;
               existing.atraso        = updateData.atraso;
               await existing.save();
               updated++;
             } else {
               await InadimplenciaDetalhe.create({ ...matchQuery, ...updateData });
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

      // Finaliza progresso
      if (io) io.emit('spreadsheet-progress', { percent: 100, status: 'finalizado' });
      res.json({ success: true, importBatch, created, updated, errors, total: records.length });
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
        {
          $group: {
            _id: "$lead",
            cliente: { $first: "$cliente" },
            cpfCnpj: { $first: "$cpfCnpj" },
            empreendimento: { $first: "$empreendimento" },
            contrato: { $first: "$contrato" },
            telefone1: { $first: "$telefone1" },
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
            totalGeral: 1,
            totalPrincipalGeral: 1,
            totalVencido: 1,
            totalFuturo: 1,
            qtdVencidas: 1,
            charges: 1,
            status: "$leadInfo.status"
          }
        },
        { $sort: { totalVencido: -1 } }
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
      const resDebts = await InadimplenciaDetalhe.deleteMany({ userId });
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

      const matchStage = { user: uid };
      if (leadId) matchStage.lead = new (require('mongoose').Types.ObjectId)(leadId);

      const debtors = await InadimplenciaDetalhe.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$lead",
            cliente: { $first: "$cliente" },
            cpfCnpj: { $first: "$cpfCnpj" },
            empreendimento: { $first: "$empreendimento" },
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

      for (const d of debtors) {
        // Bloco do Devedor
        doc.fillColor(primaryColor).fontSize(14).font('Helvetica-Bold').text('DADOS DO DEVEDOR', { underline: true });
        doc.moveDown(0.5);
        
        doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold').text(`Nome: `, { continued: true }).font('Helvetica').text(d.cliente || '—');
        doc.font('Helvetica-Bold').text(`CPF/CNPJ: `, { continued: true }).font('Helvetica').text(d.cpfCnpj || '—');
        doc.font('Helvetica-Bold').text(`Empreendimento: `, { continued: true }).font('Helvetica').text(d.empreendimento || '—');
        doc.font('Helvetica-Bold').text(`Status Atual: `, { continued: true }).font('Helvetica').text((d.leadInfo?.status || 'novo').toUpperCase());
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
