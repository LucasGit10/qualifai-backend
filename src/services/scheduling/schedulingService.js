// Orquestrar todo o fluxo de agendamento de reuniões, do início ao fim.
const logger = require('../../utils/logger');
const crypto = require('crypto');
const Event = require('../../models/Events'); 
const { 
  createEvent: createGoogleCalendarEvent,
} = require('../googleCalendarServices'); 
const hubspotService = require('../hubspotService'); 
const pipedriveService = require('../pipedriveService'); 
const zohoService = require('../zohoService'); 
const kommoService = require('../kommoService'); 

const openai = require('../ai/openAIClient');

class SchedulingService {

  async getAvailableSlots(user) {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

    const localBusySlots = await Event.find({
        user: user._id,
        start: { $lt: sevenDaysFromNow },
        end: { $gt: now }
    }).select('start end').lean();

    let googleBusySlots = [];
    try {
      if (typeof getBusySlots === 'function') {
        googleBusySlots = await getBusySlots(user, now, sevenDaysFromNow);
      } else {
        logger.warn(`Função 'getBusySlots' não encontrada em googleCalendarServices. Verificação de disponibilidade pode estar incompleta.`);
      }
    } catch (e) {
      logger.error(`Não foi possível buscar slots do Google Calendar para ${user.email}. A disponibilidade pode estar incorreta.`, e.message);
    }

    const allBusySlots = [...localBusySlots, ...googleBusySlots];

    const availableSlots = [];
    const meetingDuration = 30 * 60 * 1000;

    for (let i = 1; i <= 7; i++) {
        const day = new Date();
        day.setDate(now.getDate() + i);
        const dayOfWeek = day.getDay();
        if (dayOfWeek === 0 || dayOfWeek === 6) continue;

        for (let hour = 9; hour < 17; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                if (availableSlots.length >= 5) break;

                const slotStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, minute);
                if (slotStart < now) continue;

                const slotEnd = new Date(slotStart.getTime() + meetingDuration);
                if (slotEnd.getHours() >= 17 && (slotEnd.getMinutes() > 0 || slotEnd.getHours() > 17)) continue;

                const isBusy = allBusySlots.some(busyEvent =>
                    (slotStart < new Date(busyEvent.end) && slotEnd > new Date(busyEvent.start))
                );

                if (!isBusy) {
                    availableSlots.push(slotStart);
                }
            }
            if (availableSlots.length >= 5) break;
        }
        if (availableSlots.length >= 5) break;
    }
    return availableSlots;
  }

  async generateSchedulingProposal(conversation, lead, userSettings, availableSlots) {
    if (availableSlots.length === 0) {
        return "Parece que não tenho horários disponíveis no momento. Um de nossos consultores entrará em contato em breve para agendar um horário com você.";
    }

    const formattedSlots = availableSlots.map(slot => 
        `- ${slot.toLocaleString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}` // TODO: Usar fuso horário do 'userSettings'
    ).join('\n');
    
    return `Para agilizarmos, tenho alguns horários disponíveis para uma breve conversa. Algum destes funciona para você?\n\n${formattedSlots}\n\nCaso contrário, pode me dizer qual seria um bom dia e horário?`;
  }
  
  async parseLeadSchedulingResponse(conversation, leadMessage) {
    const proposedTimesISO = conversation.schedulingAttempt.proposedTimes.map(s => s.toISOString()).join(', ');
    const history = conversation.messages.map(m => `${m.role}: ${m.content}`).join('\n');
    const now = new Date();
    const currentTimeISO = now.toISOString();
    const userTimezone = 'America/Sao_Paulo';

    const systemPrompt = `Você é um sistema de análise de agendamento de alta precisão em português do Brasil. Sua tarefa é analisar a resposta de um lead a uma proposta de agendamento e retornar um objeto JSON.

    ### Contexto
    - **Data e Hora Atuais (UTC):** ${currentTimeISO}
    - **Fuso Horário do Usuário (para interpretação):** ${userTimezone}
    - **Horários Propostos pela IA (em UTC):** [${proposedTimesISO}]
    - **Histórico da Conversa:** A IA acabou de propor os horários. A resposta do lead é a última mensagem do histórico.

    ### Formato de Saída (OBRIGATÓRIO)
    Sua resposta DEVE ser um objeto JSON, e NADA MAIS. O JSON deve ter o seguinte formato:
    {
      "status": "CONFIRMED | REJECTED | NEGOTIATING | UNCLEAR",
      "dateTime": "YYYY-MM-DDTHH:mm:ss.sssZ | null"
    }

    ### Regras de Classificação
    1.  **STATUS: CONFIRMED**
        - O lead aceitou **explicitamente** um dos horários propostos ou sugeriu um **novo horário válido e específico**.
        - **AÇÃO:** Calcule a data e hora exata em UTC (formato ISO 8601 com 'Z') e preencha o campo \`dateTime\`.

    2.  **STATUS: NEGOTIATING**
        - O lead **rejeitou os horários propostos E pediu por novas opções**.
        - **AÇÃO:** O campo \`dateTime\` deve ser \`null\`.

    3.  **STATUS: REJECTED**
        - O lead **recusou a reunião** e não demonstrou interesse em reagendar.
        - **AÇÃO:** O campo \`dateTime\` deve ser \`null\`.

    4.  **STATUS: UNCLEAR**
        - A resposta do lead é **ambígua**, não está relacionada ao agendamento, ou é uma pergunta.
        - **AÇÃO:** O campo \`dateTime\` deve ser \`null\`.`;
    
    const userPrompt = `### Histórico da Conversa:\n${history}\n\n### Última Resposta do Lead:\n"${leadMessage}"\n\n### JSON de Análise:`;
    
    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            response_format: { type: "json_object" },
        });

        const parsedJson = JSON.parse(response.choices[0].message.content);
        logger.info(`[Scheduling Parse] Input: "${leadMessage}", Output:`, parsedJson);
        
        if (parsedJson.status === 'CONFIRMED' && parsedJson.dateTime) {
            const confirmedDate = new Date(parsedJson.dateTime);
            if (isNaN(confirmedDate.getTime())) {
                logger.warn(`[Scheduling Parse] OpenAI retornou uma data inválida: ${parsedJson.dateTime}. Revertendo para UNCLEAR.`);
                return { status: "UNCLEAR", dateTime: null };
            }
        }

        return parsedJson;

    } catch (error) {
        logger.error('Erro ao analisar a resposta de agendamento (OpenAI):', error);
        return { status: "UNCLEAR", dateTime: null };
    }
  }

  async createMeetingInCRMs(user, lead, dateTime) {
    const meetingEndTime = new Date(dateTime.getTime() + 30 * 60 * 1000);
    
    let googleMeetLink = null;
    let googleCalendarSimulated = false;
    let googleCalendarError = null;

    try {
        const attendees = [user.email];
        const hasValidLeadEmail = lead.email && !lead.email.includes('@whatsapp.qualifai') && !lead.email.includes('@whatsapp.campaign');

        if (hasValidLeadEmail) {
            attendees.push(lead.email);
        }

        logger.info(`[Scheduling] Creating Google Calendar event for lead ${lead._id} with attendees: ${attendees.join(', ')}`);
        
        const gcalResult = await createGoogleCalendarEvent({
            summary: `QualifAI Demo: ${lead.name}`,
            description: `Demonstração da plataforma QualifAI com ${lead.name} da empresa ${lead.company}.`,
            startDateTime: dateTime.toISOString(),
            endDateTime: meetingEndTime.toISOString(),
            attendeesEmails: attendees,
        }, user);

        if (gcalResult.simulated) {
            googleCalendarSimulated = true;
            if (gcalResult.error) {
                googleCalendarError = gcalResult.error;
            }
            logger.warn(`[Scheduling] Google Calendar event was SIMULATED for lead ${lead._id}. Reason: ${gcalResult.error || 'Credentials not configured'}`);
        } else {
            logger.info(`[Scheduling] Google Calendar event created successfully for lead ${lead._id}`);
        }
        
        googleMeetLink = gcalResult.event?.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri;
        
    } catch (gcalError) {
        logger.error(`[Scheduling] Unexpected failure from Google Calendar service for lead ${lead._id}:`, gcalError.message);
        googleCalendarError = gcalError.message;
        googleCalendarSimulated = true;
    }
    
    const eventId = crypto.randomUUID();
    const localEvent = new Event({
        title: `Reunião: ${lead.name} (${lead.company})`,
        description: `Reunião agendada automaticamente via QualifAI com o lead ${lead.name}.`,
        start: dateTime,
        end: meetingEndTime,
        user: user._id,
        lead: lead._id,
        meetLink: googleMeetLink,
        crmSource: 'qualifai-local',
        crmEventId: eventId,
    });
    
    localEvent.crmIds.set('manual', `qualifai_${eventId}`);
    await localEvent.save();
    logger.info(`[Scheduling] Evento local salvo no banco de dados com sucesso. ID: ${localEvent._id}`);
    
    const userSettings = { ...user.settings, userId: user._id };
    const eventDetails = {
        title: `QualifAI Meeting: ${lead.name}`,
        description: `Reuniao lead ${lead.name} da empresa ${lead.company}. Email: ${lead.email}` + (googleMeetLink ? `\nLink da Reunião: ${googleMeetLink}` : ''),
        startTime: dateTime,
        endTime: meetingEndTime
    };
    
    if (userSettings.integrations?.kommo?.enabled) {
        try {
            const kommoEventDetails = { 
              text: eventDetails.title + '\n' + eventDetails.description, 
              complete_till: Math.floor(dateTime.getTime() / 1000) 
            };
            await kommoService.createKommoTask(lead, userSettings, kommoEventDetails);
            logger.info(`[Scheduling] Kommo task created for lead ${lead._id}`);
        } catch (e) { logger.error(`[Scheduling] Failed to create Kommo task:`, e.message); }
    }
    if (userSettings.integrations?.hubspot?.enabled) {
        try {
            await hubspotService.createHubSpotTask(lead, user._id, userSettings, eventDetails);
            logger.info(`[Scheduling] HubSpot task created for lead ${lead._id}`);
        } catch (e) { logger.error(`[Scheduling] Failed to create HubSpot task:`, e.message); }
    }
    if (userSettings.integrations?.pipedrive?.enabled) {
       try {
            await pipedriveService.createPipedriveActivity(lead, eventDetails, userSettings);
            logger.info(`[Scheduling] Pipedrive activity created for lead ${lead._id}`);
        } catch (e) { logger.error(`[Scheduling] Failed to create Pipedrive activity:`, e.message); }
    }
    if (userSettings.integrations?.zoho?.enabled) {
        try {
            await zohoService.createZohoEvent(lead, eventDetails, userSettings);
            logger.info(`[Scheduling] Zoho event created for lead ${lead._id}`);
        } catch (e) { logger.error(`[Scheduling] Failed to create Zoho event:`, e.message); }
    }

    return { localEvent, googleMeetLink, googleCalendarSimulated, googleCalendarError };
  }
}

module.exports = new SchedulingService();