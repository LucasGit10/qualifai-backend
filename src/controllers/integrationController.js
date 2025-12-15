const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Lead = require('../models/Lead');
const logger = require('../utils/logger');
const hubspotService = require('../services/hubspotService');
const pipedriveService = require('../services/pipedriveService');
const salesforceService = require('../services/salesforceService');
const rdstationService = require('../services/rdstationService');
const pipefyService = require('../services/pipefyService');
const zohoService = require('../services/zohoService');
const kommoService = require('../services/kommoService');
const integrationUtils = require('../services/integrationUtils');

class IntegrationController {

    async updateSettings(req, res) {
        try {
            const { integrations: newIntegrations } = req.body;
            const userId = req.user.id;

            // Buscar usuário e suas configurações antigas
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'Usuário não encontrado.' });
            }
            const oldUser = user.toObject();

            // Lógica de proteção e troca de código para Kommo
            if (newIntegrations.kommo && newIntegrations.kommo.enabled) {
                if (newIntegrations.kommo.authorizationCode) {
                    try {
                        const { subdomain, clientId, clientSecret, authorizationCode } = newIntegrations.kommo;
                        if (!subdomain || !clientId || !clientSecret || !authorizationCode) {
                            return res.status(400).json({ message: 'Para conectar com Kommo, Subdomínio, ID de Integração, Chave Secreta e Código de Autorização são obrigatórios.' });
                        }
                        const tokens = await kommoService.exchangeCodeForTokens(
                            authorizationCode,
                            subdomain,
                            clientId,
                            clientSecret
                        );

                        if (!tokens.refreshToken) {
                            throw new Error('Não foi possível obter o Refresh Token da Kommo. Verifique se o Código de Autorização é válido e não foi usado anteriormente.');
                        }
                        
                        newIntegrations.kommo.refreshToken = tokens.refreshToken;
                        // Remove o código de autorização de uso único para que não seja armazenado
                        delete newIntegrations.kommo.authorizationCode;
                        
                    } catch (error) {
                        logger.error(`Falha ao trocar código de autorização do Kommo para o usuário ${userId}:`, { message: error.message });
                        return res.status(400).json({ 
                            message: `Falha ao conectar com a Kommo: ${error.message}. Verifique suas credenciais e tente novamente.`
                        });
                    }
                } else {
                    // Preserva o refresh token existente se não estiver fornecendo um novo código de autorização
                    const existingKommoToken = user.settings?.integrations?.kommo?.refreshToken;
                    if (existingKommoToken) {
                        newIntegrations.kommo.refreshToken = existingKommoToken;
                    } else if (newIntegrations.kommo.enabled) {
                        // Está habilitado, mas não há código de autorização e nenhum refresh token existente. Estado inválido.
                        return res.status(400).json({ message: 'Para habilitar a integração Kommo, por favor forneça um novo Código de Autorização.' });
                    }
                }
            }


            // Atualizar e buscar novas configurações
            const updatedUser = await User.findByIdAndUpdate(
              userId,
              { 'settings.integrations': newIntegrations },
              { new: true }
            );

            // Verificar quais integrações foram recém-ativadas
            for (const integrationName in newIntegrations) {
                if (Object.prototype.hasOwnProperty.call(newIntegrations, integrationName)) {
                    const oldIsEnabled = oldUser.settings?.integrations?.[integrationName]?.enabled || false;
                    const newIsEnabled = newIntegrations[integrationName]?.enabled || false;

                    // Se a integração foi ativada (de false para true)
                    if (newIsEnabled && !oldIsEnabled) {
                        logger.info(`Integração ${integrationName} ativada para o usuário ${userId}. Marcando todos os leads como pendentes.`);
                        
                        const updateQuery = { $set: {} };
                        updateQuery.$set[`${integrationName}.syncStatus`] = 'pending';
                        
                        // Marcar todos os leads do usuário como pendentes para esta integração
                        await Lead.updateMany(
                            { user: userId },
                            updateQuery
                        );
                    }
                }
            }

            res.json({ success: true, integrations: updatedUser.settings.integrations });
        } catch (error) {
            logger.error('Erro ao atualizar configurações de integração:', error);
            res.status(500).json({ message: 'Erro interno do servidor ao salvar configurações.' });
        }
    }

  async importFromAllCRMs(req, res) {
    try {
      const userId = req.user.id;
      const user = await User.findById(userId);
      const integrations = user.settings?.integrations || {};

      const platformConfigs = {
        hubspot: { fetch: hubspotService.fetchHubspotLeads, idField: 'contactId', syncMethod: 'syncWithHubspot' },
        pipedrive: { fetch: pipedriveService.fetchPipedriveLeads, idField: 'personId', syncMethod: 'syncWithPipedrive' },
        salesforce: { fetch: salesforceService.fetchSalesforceLeads, idField: 'id', syncMethod: 'syncWithSalesforce' },
        rdstation: { fetch: rdstationService.fetchRdstationLeads, idField: 'id', syncMethod: 'syncWithRDStation' },
        zoho: { fetch: zohoService.fetchZohoLeads, idField: 'id', syncMethod: 'syncWithZoho' },
        kommo: { fetch: kommoService.fetchKommoLeads, idField: 'id', syncMethod: 'syncWithKommo' }
      };

      const enabledPlatforms = Object.keys(platformConfigs).filter(p => integrations[p]?.enabled);

      if (enabledPlatforms.length === 0) {
        return res.status(400).json({ message: 'Nenhuma integração de CRM suportada está ativa.' });
      }

      const allCrmLeads = [];
      let unlinkedCount = 0;

      for (const platform of enabledPlatforms) {
        try {
          const config = platformConfigs[platform];
          const crmLeads = await config.fetch({ ...user.settings, userId });
          allCrmLeads.push(...crmLeads);

          // Lógica de detecção e tratamento de exclusão
          const crmLeadIds = new Set(crmLeads.map(l => l[platform]?.[config.idField]).filter(Boolean));
          
          const qualifaiLeadsForPlatform = await Lead.find({
            user: userId,
            [`${platform}.${config.idField}`]: { $exists: true, $ne: null }
          }).select(`_id ${platform}.${config.idField}`);
          
          const leadsToUnlink = qualifaiLeadsForPlatform.filter(lead => 
            !crmLeadIds.has(lead[platform]?.[config.idField])
          );

          if (leadsToUnlink.length > 0) {
            logger.info(`[Import] ${leadsToUnlink.length} leads deletados em ${platform} detectados. Desvinculando...`);
            for (const lead of leadsToUnlink) {
              try {
                const fullLead = await Lead.findById(lead._id);
                if (fullLead && fullLead[config.syncMethod]) {
                  await fullLead[config.syncMethod]({ ...user.settings, userId });
                  unlinkedCount++;
                }
              } catch (unlinkError) {
                 logger.error(`[Import] Erro ao desvincular o lead ${lead._id} de ${platform}:`, unlinkError.message);
              }
            }
          }
        } catch (err) {
          const errorMessage = err.response?.data || err.message || err;
          logger.error(`Erro ao processar importação para ${platform}:`, errorMessage);
        }
      }

      if (allCrmLeads.length === 0 && unlinkedCount === 0) {
        return res.json({
          success: true,
          message: 'Nenhum novo lead encontrado e nenhuma exclusão detectada nos CRMs.',
          created: 0,
          skipped: 0,
          unlinked: 0
        });
      }

      // Mesclar e desduplicar leads, combinando dados de múltiplas fontes de CRM
      const mergedLeadsMap = new Map();
      for (const crmLead of allCrmLeads) {
        if (crmLead.email) {
          const email = crmLead.email.toLowerCase();
          const existingLead = mergedLeadsMap.get(email);
          mergedLeadsMap.set(email, { ...existingLead, ...crmLead });
        }
      }
      const uniqueLeadsByEmail = Array.from(mergedLeadsMap.values());

      const emailsToCheck = uniqueLeadsByEmail.map(l => l.email.toLowerCase());
      const existingLeadEmails = new Set(
        (await Lead.find({ user: userId, email: { $in: emailsToCheck } }).select('email').lean())
        .map(l => l.email.toLowerCase())
      );

      const bulkImportOps = [];
      for (const crmLead of uniqueLeadsByEmail) {
        if (!existingLeadEmails.has(crmLead.email.toLowerCase())) {
          bulkImportOps.push({
            insertOne: {
              document: { ...crmLead, user: userId }
            }
          });
        }
      }

      if (bulkImportOps.length > 0) {
        await Lead.bulkWrite(bulkImportOps);
      }

      const createdCount = bulkImportOps.length;
      const skippedCount = uniqueLeadsByEmail.length - createdCount;

      res.json({
        success: true,
        message: 'Importação concluída.',
        created: createdCount,
        skipped: skippedCount,
        unlinked: unlinkedCount
      });

    } catch (error) {
      logger.error('Erro na importação de CRMs:', error);
      res.status(500).json({ message: 'Erro interno do servidor ao importar leads.' });
    }
  }

    async testPipefyConnection(req, res) {
        try {
            const userId = req.user.id;
            const user = await User.findById(userId);

            if (!user.settings?.integrations?.pipefy?.enabled) {
                return res.status(400).json({ message: 'A integração com o Pipefy não está ativa.' });
            }

            const fields = await pipefyService.getPipefyPipelineFields({ ...user.settings, userId });

            res.json({
                success: true,
                message: 'Conexão com Pipefy bem-sucedida!',
                fields: fields
            });

        } catch (error) {
            logger.error('Erro ao testar conexão com Pipefy:', error);
            res.status(400).json({
                success: false,
                message: error.message || 'Não foi possível conectar ao Pipefy. Verifique suas credenciais e o ID do Pipeline.'
            });
        }
    }

    async hubspotAuthUrl(req, res) {
        try {
            const { HUBSPOT_CLIENT_ID } = process.env;
            const redirectUri = `${process.env.BACKEND_URL || 'http://localhost:3001'}/api/integrations/hubspot/callback`;

            if (!HUBSPOT_CLIENT_ID) {
                logger.error('[HubSpot Auth URL] HUBSPOT_CLIENT_ID não está configurado no servidor.');
                return res.status(400).json({ message: 'A integração com HubSpot não está configurada no servidor.' });
            }
            
            const userId = req.user.id;
            const stateToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
            
            const scopes = [
                'crm.objects.contacts.read', 'crm.objects.contacts.write',
                'crm.objects.deals.read', 'crm.objects.deals.write',
                'crm.schemas.contacts.read', 'crm.schemas.deals.read',
                'tickets' 
            ].join(' ');
            
            const authUrl = `https://app.hubspot.com/oauth/authorize?client_id=${HUBSPOT_CLIENT_ID}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scopes)}&state=${stateToken}`;
            
            res.json({ url: authUrl });
        } catch (error) {
            logger.error('[HubSpot Auth URL] Erro ao gerar URL:', error);
            res.status(500).json({ message: 'Erro ao iniciar autorização com HubSpot.' });
        }
    }

    async hubspotCallback(req, res) {
        const { code, state, error: hubspotError } = req.query;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        if (hubspotError) {
            logger.error('[HubSpot Callback] Erro retornado pelo HubSpot:', hubspotError);
            return res.redirect(`${frontendUrl}/app/settings?hubspot_auth=error&message=${encodeURIComponent(`Erro do HubSpot: ${hubspotError}`)}`);
        }

        if (!code || !state) {
            logger.error('[HubSpot Callback] Código ou state ausente na query.');
            return res.redirect(`${frontendUrl}/app/settings?hubspot_auth=error&message=Parâmetros de autenticação inválidos.`);
        }

        try {
            const decoded = jwt.verify(state, process.env.JWT_SECRET);
            const userId = decoded.id;

            const tokens = await hubspotService.exchangeCodeForTokens(code);

            if (!tokens.refreshToken) {
                throw new Error('Não foi possível obter o Refresh Token do HubSpot. A permissão pode já ter sido concedida anteriormente.');
            }

            await User.findByIdAndUpdate(userId, {
                'settings.integrations.hubspot.refreshToken': tokens.refreshToken,
                'settings.integrations.hubspot.enabled': true,
            });

            logger.info(`[HubSpot Callback] Integração com HubSpot ativada com sucesso para o usuário ${userId}.`);
            res.redirect(`${frontendUrl}/app/settings?hubspot_auth=success`);

        } catch (error) {
            logger.error('[HubSpot Callback] Erro no processo de callback:', error.message);
            const errorMessage = encodeURIComponent(error.message || 'Ocorreu um erro no servidor durante a autenticação.');
            res.redirect(`${frontendUrl}/app/settings?hubspot_auth=error&message=${errorMessage}`);
        }
    }

    async googleAuthUrl(req, res) {
        try {
            const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

            if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
                logger.error('[Google Auth URL] Google OAuth credentials are not configured on the server.');
                throw new Error('As credenciais do Google OAuth não estão configuradas no servidor.');
            }
            
            const oAuth2Client = new google.auth.OAuth2(
                GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET,
                GOOGLE_REDIRECT_URI
            );
            
            const userId = req.user.id;
            const stateToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
            
            const scopes = [
                'https://www.googleapis.com/auth/calendar',
                'https://www.googleapis.com/auth/userinfo.email' // FIX: Added scope
            ];
            
            const authUrl = oAuth2Client.generateAuthUrl({
                access_type: 'offline',
                scope: scopes,
                prompt: 'consent',
                state: stateToken,
            });
            
            res.json({ url: authUrl });
        } catch (error) {
            logger.error('[Google Auth URL] Erro ao gerar URL:', error);
            res.status(500).json({ message: 'Erro ao iniciar autenticação com o Google.' });
        }
    }

    async googleCallback(req, res) {
        const { code, state, error: googleError } = req.query;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        if (googleError) {
            logger.error('[Google Auth Callback] Erro retornado pelo Google:', googleError);
            return res.redirect(`${frontendUrl}/app/settings?google_auth=error&message=${encodeURIComponent(`Erro do Google: ${googleError}`)}`);
        }
        
        if (!code || !state) {
            logger.error('[Google Auth Callback] Código ou state ausente na query.');
            return res.redirect(`${frontendUrl}/app/settings?google_auth=error&message=Parâmetros de autenticação inválidos.`);
        }

        try {
            const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

            if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
                logger.error('[Google Auth Callback] As credenciais do Google OAuth não estão configuradas no servidor.');
                throw new Error('As credenciais do Google OAuth não estão configuradas no servidor.');
            }

            logger.info('[Google Auth Callback] Using credentials:', {
                clientId: GOOGLE_CLIENT_ID ? 'SET' : 'NOT SET',
                clientSecret: GOOGLE_CLIENT_SECRET ? 'SET' : 'NOT SET',
                redirectUri: GOOGLE_REDIRECT_URI
            });
            
            const oAuth2Client = new google.auth.OAuth2(
                GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET,
                GOOGLE_REDIRECT_URI
            );

            const decoded = jwt.verify(state, process.env.JWT_SECRET);
            const userId = decoded.id;

            const { tokens } = await oAuth2Client.getToken(code);
            logger.info('[Google Auth Callback] Received tokens from Google.', { hasAccessToken: !!tokens.access_token, hasRefreshToken: !!tokens.refresh_token });

            if (!tokens.refresh_token) {
                logger.warn(`[Google Auth] No refresh token received for user ${userId}. This can happen if the user has previously granted consent.`);
                const user = await User.findById(userId);
                if (!user.settings?.integrations?.google?.refreshToken) {
                     return res.redirect(`${frontendUrl}/app/settings?google_auth=error&message=${encodeURIComponent('Falha ao obter permissão de acesso offline. Tente remover o acesso da QualifAI da sua conta Google e conectar novamente.')}`);
                }
            }
            
            oAuth2Client.setCredentials(tokens);

            const oauth2 = google.oauth2({
                auth: oAuth2Client,
                version: 'v2'
            });
            const { data } = await oauth2.userinfo.get();

            const updateData = {
                'settings.integrations.google.enabled': true,
                'settings.integrations.google.userEmail': data.email,
            };

            if (tokens.refresh_token) {
                updateData['settings.integrations.google.refreshToken'] = tokens.refresh_token;
            }

            await User.findByIdAndUpdate(userId, updateData);

            res.redirect(`${frontendUrl}/app/settings?google_auth=success`);
        } catch (error) {
            logger.error('[Google Auth Callback] Erro:', {
                message: error.message,
                stack: error.stack,
                response: error.response?.data
            });
             const errorMessage = (error instanceof jwt.JsonWebTokenError) 
                ? 'Sessão de autenticação inválida ou expirada. Por favor, tente novamente.'
                : error.message || 'Ocorreu um erro no servidor durante a autenticação. Verifique as configurações.';
            res.redirect(`${frontendUrl}/app/settings?google_auth=error&message=${encodeURIComponent(errorMessage)}`);
        }
    }

    async googleDisconnect(req, res) {
        try {
            const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

            if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
                logger.warn('[Google Disconnect] Client ID or Secret not configured, cannot revoke token.');
            }

            const oAuth2Client = new google.auth.OAuth2(
                GOOGLE_CLIENT_ID,
                GOOGLE_CLIENT_SECRET,
                GOOGLE_REDIRECT_URI
            );
            
            const userId = req.user.id;
            const user = await User.findById(userId);

            const refreshToken = user.settings?.integrations?.google?.refreshToken;
            if (refreshToken && GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
                // This call might fail if the token is already invalid, but we proceed anyway.
                await oAuth2Client.revokeToken(refreshToken).catch(err => logger.warn(`[Google Disconnect] Failed to revoke token for user ${userId}: ${err.message}`));
            }

            const updatedUser = await User.findByIdAndUpdate(userId, {
                $unset: { 
                    'settings.integrations.google': ""
                }
            }, { new: true });

            res.json({ success: true, user: updatedUser });
        } catch (error) {
            logger.error('[Google Disconnect] Erro:', error);
            res.status(500).json({ message: 'Erro ao desconectar a conta do Google.' });
        }
    }

    async testGoogleCalendar(req, res) {
        try {
            const userId = req.user.id;
            const user = await User.findById(userId);

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            if (!user.settings?.integrations?.google?.enabled || !user.settings?.integrations?.google?.refreshToken) {
                return res.status(400).json({ message: 'A conta Google do usuário não está conectada ou a integração está desativada.' });
            }

            logger.info(`[Google Calendar Test] Iniciando teste para o usuário: ${user.email}`);

            const now = new Date();
            const startDateTime = new Date(now.getTime() + 5 * 60000).toISOString(); // 5 minutes from now
            const endDateTime = new Date(now.getTime() + 35 * 60000).toISOString(); // 35 minutes from now (30 min duration)

            const testEventData = {
                summary: 'QualifAI - Evento de Teste',
                description: `Este é um evento de teste gerado pela plataforma QualifAI para o usuário ${user.name}.`,
                startDateTime,
                endDateTime,
                attendeesEmails: [user.email],
            };

            const result = await require('../services/googleCalendarServices').createEvent(testEventData, user);

            if (result.simulated) {
                logger.warn(`[Google Calendar Test] A criação do evento foi simulada.`, { error: result.error });
                return res.status(200).json({
                    success: true,
                    message: 'A criação do evento foi simulada. Verifique as credenciais do Google no servidor ou do usuário.',
                    details: result.error,
                    event: result.event
                });
            }

            logger.info(`[Google Calendar Test] Evento de teste criado com sucesso.`, { eventId: result.event?.id });

            res.status(200).json({
                success: true,
                message: 'Evento de teste criado com sucesso no Google Calendar!',
                event: result.event
            });

        } catch (error) {
            logger.error('[Google Calendar Test] Erro durante o teste:', {
                message: error.message,
                response: error.response?.data
            });
            res.status(500).json({
                success: false,
                message: 'Erro interno ao criar evento de teste no Google Calendar.',
                error: error.message
            });
        }
    }

    async kommoCallback(req, res) {
        const { code } = req.query;
        if (code) {
            res.send(`<h1>Sucesso!</h1><p>Seu código de autorização é: <strong>${code}</strong></p><p>Copie este código e cole no campo "Código de Autorização" na página de configurações do QualifAI.</p><p>Você já pode fechar esta janela.</p>`);
        } else {
            res.status(400).send('<h1>Erro</h1><p>Nenhum código de autorização foi encontrado na URL. Por favor, tente o processo de autorização no Kommo novamente.</p>');
        }
    }

    async kommoDisconnect(req, res) {
        try {
            const userId = req.user.id;
            const updatedUser = await User.findByIdAndUpdate(userId, {
                $set: {
                    'settings.integrations.kommo.enabled': false,
                    'settings.integrations.kommo.refreshToken': null
                }
            }, { new: true });

            res.json({ success: true, integrations: updatedUser.settings.integrations });
        } catch (error) {
            logger.error('[Kommo Disconnect] Erro:', error);
            res.status(500).json({ message: 'Erro ao desconectar a conta do Kommo.' });
        }
    }
    
    async pipedriveAuthUrl(req, res) {
        try {
            const { PIPEDRIVE_CLIENT_ID } = process.env;
            if (!PIPEDRIVE_CLIENT_ID) {
                return res.status(400).json({ message: 'A integração com Pipedrive não está configurada no servidor.' });
            }
            
            const userId = req.user.id;
            const stateToken = jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '10m' });
            const redirectUri = `${process.env.BACKEND_URL || 'https://qualifai.tech'}/api/integrations/pipedrive/callback`;
            
            const authUrl = `https://oauth.pipedrive.com/oauth/authorize?client_id=${PIPEDRIVE_CLIENT_ID}&state=${stateToken}&redirect_uri=${redirectUri}`;
            
            res.json({ url: authUrl });

        } catch (error) {
            logger.error('[Pipedrive Auth URL] Erro ao gerar URL:', error);
            res.status(500).json({ message: 'Erro ao iniciar autorização com Pipedrive.' });
        }
    }

    async pipedriveCallback(req, res) {
        const { code, state } = req.query;
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';

        try {
            if (!code || !state) {
                throw new Error('Código de autorização ou estado ausente no callback do Pipedrive.');
            }
            
            const decoded = jwt.verify(state, process.env.JWT_SECRET);
            const userId = decoded.id;

            const tokens = await pipedriveService.exchangeCodeForTokens(code);

            if (!tokens.refreshToken || !tokens.apiDomain) {
                throw new Error('Não foi possível obter o Refresh Token ou o Domínio da API do Pipedrive.');
            }

            await User.findByIdAndUpdate(userId, {
                'settings.integrations.pipedrive.refreshToken': tokens.refreshToken,
                'settings.integrations.pipedrive.apiDomain': tokens.apiDomain,
                'settings.integrations.pipedrive.enabled': true,
            });

            res.redirect(`${frontendUrl}/app/settings?pipedrive_auth=success`);

        } catch (error) {
            logger.error('[Pipedrive Callback] Erro:', error.message);
            const errorMessage = encodeURIComponent(error.message || 'Ocorreu um erro no servidor durante a autenticação do Pipedrive.');
            res.redirect(`${frontendUrl}/app/settings?pipedrive_auth=error&message=${errorMessage}`);
        }
    }

    async pipedriveDisconnect(req, res) {
        try {
            const userId = req.user.id;
            const updatedUser = await User.findByIdAndUpdate(userId, {
                $set: {
                    'settings.integrations.pipedrive.enabled': false,
                    'settings.integrations.pipedrive.refreshToken': null,
                    'settings.integrations.pipedrive.apiDomain': null
                }
            }, { new: true });

            res.json({ success: true, integrations: updatedUser.settings.integrations });
        } catch (error) {
            logger.error('[Pipedrive Disconnect] Erro:', error);
            res.status(500).json({ message: 'Erro ao desconectar a conta do Pipedrive.' });
        }
    }
}

module.exports = new IntegrationController();