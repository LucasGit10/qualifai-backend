const axios = require('axios');
const Lead = require('../models/Lead');

const lushaApi = axios.create({
  baseURL: 'https://api.lusha.com',
  headers: {
    'Content-Type': 'application/json',
    'api_key': process.env.LUSHA_API_KEY
  }
});

/**
 * FUNÇÃO DE BUSCA DE PROSPECÇÃO - CORRIGIDA COM EMPRESAS REAIS
 */
async function prospectContacts(filtersFromReact) {
  // VALIDAÇÃO
  if (!filtersFromReact || Object.keys(filtersFromReact).length === 0) {
    throw new Error('Pelo menos um filtro é obrigatório');
  }

  console.log('🔍 Filtros recebidos do React:', filtersFromReact);

  // CONSTRUIR PAYLOAD CORRETO
  const payload = {
    pages: {
      page: 0,
      size: 20
    },
    includePartialContact: true, // ✅ Inclui contatos parciais
    filters: {
      contacts: {
        include: {}
      },
      companies: {
        include: {}
      }
    }
  };

  // 🎯 1. FILTROS DE CONTATO (OBRIGATÓRIOS)
  
  // Cargos do usuário OU cargos padrão otimizados
  if (filtersFromReact.jobTitle && filtersFromReact.jobTitle.trim()) {
    payload.filters.contacts.include.jobTitles = filtersFromReact.jobTitle
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    console.log('✅ Filtro de cargos aplicado:', payload.filters.contacts.include.jobTitles);
  } else {
    // CARGOS PADRÃO MAIS EFETIVOS
    payload.filters.contacts.include.jobTitles = [
      'Chief Executive Officer',
      'Chief Technology Officer', 
      'Sales Director',
      'Marketing Director',
      'Business Development Manager',
      'Head of Sales',
      'Head of Marketing'
    ];
    console.log('🎯 Cargos padrão aplicados:', payload.filters.contacts.include.jobTitles);
  }

  // Localização
  if (filtersFromReact.location && filtersFromReact.location.trim()) {
    const locationsArray = filtersFromReact.location
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    
    payload.filters.contacts.include.locations = locationsArray.map(location => ({
      country: location
    }));
    console.log('✅ Filtro de localização aplicado:', payload.filters.contacts.include.locations);
  } else {
    // Localização padrão
    payload.filters.contacts.include.locations = [{ country: "Brazil" }];
    console.log('🎯 Localização padrão aplicada: Brazil');
  }

  // 🎯 2. CORREÇÃO CRÍTICA: MAPEAR SETORES PARA EMPRESAS REAIS
  if (filtersFromReact.industry && filtersFromReact.industry.trim()) {
    const industries = filtersFromReact.industry
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    
    // 🚀 CONVERSÃO DE SETORES PARA EMPRESAS REAIS
    const companyMapping = {
      // Vendas & Marketing
      'vendas': ['RD Station', 'Resultados Digitais', 'HubSpot', 'Salesforce', 'Pipefy'],
      'sales': ['RD Station', 'Resultados Digitais', 'HubSpot', 'Salesforce', 'Pipefy'],
      'marketing': ['RD Station', 'Resultados Digitais', 'HubSpot', 'Rock Content', 'Resultados Digitais'],
      
      // Tecnologia
      'tecnologia': ['Nubank', 'iFood', 'Stone', 'PagSeguro', 'PicPay'],
      'technology': ['Nubank', 'iFood', 'Stone', 'PagSeguro', 'PicPay'],
      'software': ['TOTVS', 'SAP', 'Microsoft', 'Oracle', 'IBM'],
      'ti': ['Accenture', 'IBM', 'Dell', 'HP', 'Cisco'],
      
      // Finanças
      'finanças': ['Nubank', 'Itaú', 'Bradesco', 'Santander', 'Banco do Brasil'],
      'finance': ['Nubank', 'Itaú', 'Bradesco', 'Santander', 'Banco do Brasil'],
      'fintech': ['Nubank', 'PicPay', 'C6 Bank', 'Inter', 'Warren'],
      
      // E-commerce
      'ecommerce': ['Mercado Livre', 'Americanas', 'Magazine Luiza', 'Via', 'Amazon'],
      'e-commerce': ['Mercado Livre', 'Americanas', 'Magazine Luiza', 'Via', 'Amazon']
    };

    let targetCompanies = [];
    
    industries.forEach(industry => {
      const industryLower = industry.toLowerCase();
      let foundCompanies = [];
      
      // Busca empresas no mapping
      for (const [key, companies] of Object.entries(companyMapping)) {
        if (industryLower.includes(key)) {
          foundCompanies = [...foundCompanies, ...companies];
        }
      }
      
      // Se não encontrou no mapping, usa empresas genéricas brasileiras
      if (foundCompanies.length === 0) {
        foundCompanies = [
          'Nubank', 'iFood', 'Mercado Livre', 'Stone', 'PagSeguro',
          'PicPay', 'C6 Bank', 'Inter', 'Warren', 'QuintoAndar'
        ];
      }
      
      targetCompanies = [...targetCompanies, ...foundCompanies];
    });

    // Remove duplicatas
    targetCompanies = [...new Set(targetCompanies)];
    
    // Limita a 10 empresas para não sobrecarregar
    targetCompanies = targetCompanies.slice(0, 10);
    
    payload.filters.companies.include.names = targetCompanies;
    console.log('🏢 Empresas mapeadas:', targetCompanies);
  }

  // Também trata company_industries se existir
  if (filtersFromReact.company_industries && filtersFromReact.company_industries.trim()) {
    const companyIndustries = filtersFromReact.company_industries
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);
    
    // Se já não tem empresas do industry, usa estas
    if (!payload.filters.companies.include.names) {
      payload.filters.companies.include.names = [
        'Nubank', 'iFood', 'Mercado Livre', 'Stone', 'PagSeguro'
      ];
      console.log('🏢 Empresas padrão aplicadas:', payload.filters.companies.include.names);
    }
  }

  // 🎯 3. FILTROS EXTRAS PARA MELHORAR RESULTADOS
  payload.filters.contacts.include.existing_data_points = ["work_email", "phone"];

  console.log('📦 Payload FINAL para Lusha:', JSON.stringify(payload, null, 2));

  try {
    const response = await lushaApi.post(
      '/prospecting/contact/search',
      payload
    );

    console.log('✅ Resposta da Lusha - Status:', response.status);
    console.log('✅ Total de contatos encontrados:', response.data.contacts?.length || 0);
    
    // Log dos primeiros resultados
    if (response.data.contacts && response.data.contacts.length > 0) {
      console.log('📋 Amostra de contatos encontrados:');
      response.data.contacts.slice(0, 5).forEach((contact, index) => {
        console.log(`   ${index + 1}. ${contact.name} - ${contact.jobTitle} at ${contact.companyName}`);
        console.log(`      📧 Email: ${contact.hasWorkEmail ? 'Sim' : 'Não'} | 📞 Telefone: ${contact.hasPhones ? 'Sim' : 'Não'}`);
      });
    } else {
      console.log('❌ Nenhum contato encontrado com esses filtros');
      console.log('💡 Dica: Tente buscar por empresas específicas como "Nubank", "iFood", "RD Station"');
    }

    return response.data.contacts || [];

  } catch (error) {
    console.error('❌ ERRO DETALHADO na API Lusha:');
    
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Data:', error.response.data);
      
      let errorMessage = 'Erro na API Lusha';
      
      if (error.response.data?.message) {
        errorMessage = error.response.data.message;
      }
      
      if (error.response.status === 400) {
        errorMessage = 'Filtros inválidos. Tente usar empresas específicas.';
      } else if (error.response.status === 429) {
        errorMessage = 'Limite de requisições excedido. Tente novamente em alguns minutos.';
      }
      
      throw new Error(errorMessage);
    } else {
      throw new Error(error.message);
    }
  }
}

/**
 * FUNÇÃO PARA SALVAR LEADS - MANTIDA
 */
async function saveOrUpdateLeads(leadsFromLusha, userId) {
  if (!leadsFromLusha || !Array.isArray(leadsFromLusha)) {
    throw new Error('Dados de leads inválidos');
  }

  const savedLeads = [];

  for (const contact of leadsFromLusha) {
    try {
      const lushaId = contact.contactId;
      const fullName = contact.name;
      const companyName = contact.companyName;
      const title = contact.jobTitle;
      
      const hasEmail = contact.hasWorkEmail || contact.hasEmails;
      const hasPhone = contact.hasPhones || contact.hasMobilePhone || contact.hasDirectPhone;

      if (!lushaId) {
        console.warn('Lead sem contactId, pulando:', fullName);
        continue;
      }

      const leadData = {
        user: userId,
        name: fullName,
        company: companyName,
        position: title,
        source: 'lusha',
        status: 'novo',
        lusha: {
          contactId: lushaId,
          companyId: contact.companyId,
          fqdn: contact.fqdn,
          isShown: contact.isShown,
          lastSync: new Date(),
          syncStatus: 'synced',
          syncError: null,
          hasEmail: hasEmail,
          hasPhone: hasPhone,
          hasCompanyInfo: contact.hasCompanyEmployeesCount || contact.hasCompanyRevenue,
          rawData: contact
        }
      };

      const updatedLead = await Lead.findOneAndUpdate(
        { 
          'lusha.contactId': lushaId, 
          user: userId 
        },
        { 
          $set: leadData,
          $setOnInsert: {
            email: null,
            phone: null,
            createdAt: new Date()
          }
        },
        { 
          new: true,
          upsert: true,
          runValidators: true
        }
      );

      savedLeads.push(updatedLead);
      console.log(`💾 Lead salvo: ${fullName} (${lushaId})`);
      
    } catch (error) {
      if (error.code === 11000) {
        console.warn('Lead duplicado, continuando...');
      } else {
        console.error(`❌ Erro ao salvar lead ${contact.name}:`, error.message);
      }
    }
  }

  console.log(`📊 Total de leads salvos: ${savedLeads.length}`);
  return savedLeads;
}

module.exports = {
  prospectContacts,
  saveOrUpdateLeads
};