const lushaService = require('../services/lusha.service');

async function prospectAndSave(req, res) {
  const filters = req.body;
  const userId = req.user?.id;

  console.log('Requisição de prospecção recebida:', { filters, userId });

  // VALIDAÇÕES
  if (!filters || Object.keys(filters).length === 0) {
    return res.status(400).json({ 
      success: false,
      message: 'Pelo menos um filtro é obrigatório.' 
    });
  }
  
  if (!userId) {
    return res.status(401).json({ 
      success: false,
      message: 'Usuário não autenticado.' 
    });
  }

  // VERIFICAR SE API KEY EXISTE
  if (!process.env.LUSHA_API_KEY) {
    return res.status(500).json({ 
      success: false,
      message: 'Configuração da API Lusha não encontrada.' 
    });
  }

  try {
    // BUSCAR CONTATOS NO LUSHA
    const leadsFromLusha = await lushaService.prospectContacts(filters);

    if (!leadsFromLusha || leadsFromLusha.length === 0) {
      return res.status(200).json({ 
        success: true,
        message: 'Nenhum lead encontrado no Lusha com os filtros fornecidos.', 
        data: [],
        total: 0
      });
    }

    console.log(`Encontrados ${leadsFromLusha.length} leads no Lusha`);

    // SALVAR NO BANCO
    const savedLeads = await lushaService.saveOrUpdateLeads(leadsFromLusha, userId);

    res.status(200).json({ 
      success: true,
      message: `${savedLeads.length} leads importados com sucesso!`, 
      data: savedLeads,
      total: savedLeads.length,
      stats: {
        withEmail: savedLeads.filter(lead => lead.lusha?.hasEmail).length,
        withPhone: savedLeads.filter(lead => lead.lusha?.hasPhone).length
      }
    });

  } catch (error) {
    console.error('Erro no controller de Prospecção Lusha:', error);
    
    // MAPEAR ERROS PARA STATUS CODES APPROPRIADOS
    let statusCode = 500;
    if (error.message.includes('autenticação') || error.message.includes('API Key')) {
      statusCode = 401;
    } else if (error.message.includes('filtro') || error.message.includes('inválida')) {
      statusCode = 400;
    } else if (error.message.includes('limite') || error.message.includes('excedido')) {
      statusCode = 429;
    }
    
    res.status(statusCode).json({ 
      success: false,
      message: error.message,
      error: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

module.exports = {
  prospectAndSave
};