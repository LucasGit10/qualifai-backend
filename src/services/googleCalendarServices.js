const { google } = require('googleapis');
const logger = require('../utils/logger');

// Helper function to create a mock event for simulation
const createMockEvent = async ({ summary, description, startDateTime, endDateTime, attendeesEmails }) => {
    return Promise.resolve({
      summary,
      description,
      start: { dateTime: startDateTime },
      end: { dateTime: endDateTime },
      attendees: attendeesEmails.map(email => ({ email })),
      conferenceData: null,
      htmlLink: 'https://calendar.google.com/event?action=VIEW',
    });
};

async function createEvent({ summary, description, startDateTime, endDateTime, attendeesEmails }, user = null) {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;

  const eventPayload = {
    summary,
    description,
    start: {
      dateTime: startDateTime,
      timeZone: 'America/Sao_Paulo',
    },
    end: {
      dateTime: endDateTime,
      timeZone: 'America/Sao_Paulo',
    },
    attendees: attendeesEmails.map(email => ({ email })),
    conferenceData: {
      createRequest: {
        requestId: `qualifai-${Date.now()}`,
        conferenceSolutionKey: { type: 'hangoutsMeet' },
      },
    },
  };

  const insertEvent = async (calendar) => {
    const response = await calendar.events.insert({
      calendarId: 'primary',
      resource: eventPayload,
      conferenceDataVersion: 1,
      sendUpdates: 'all',
    });
    return { event: response.data, simulated: false, error: null };
  };

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET || !GOOGLE_REDIRECT_URI) {
    logger.warn('[Google Calendar] Server-side Google credentials are not set. Simulating event creation.');
    const mock = await createMockEvent({ summary, description, startDateTime, endDateTime, attendeesEmails });
    return { event: mock, simulated: true, error: "Credenciais do Google Calendar não configuradas no servidor." };
  }
  
  if (user && user.settings?.integrations?.google?.enabled && user.settings?.integrations?.google?.refreshToken) {
    logger.info(`[Google Calendar] Attempting to create event using user's account: ${user.email}`);
    try {
      const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
      oAuth2Client.setCredentials({ refresh_token: user.settings.integrations.google.refreshToken });
      const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
      return await insertEvent(calendar);
    } catch (error) {
      logger.error(`[Google Calendar] Error creating event for user ${user._id}: ${error.message}. Falling back to simulation.`);
      const mock = await createMockEvent({ summary, description, startDateTime, endDateTime, attendeesEmails });
      return { event: mock, simulated: true, error: `Falha ao usar as credenciais do Google do usuário: ${error.message}` };
    }
  }

  const { GOOGLE_REFRESH_TOKEN: SYSTEM_GOOGLE_REFRESH_TOKEN } = process.env;
  if (SYSTEM_GOOGLE_REFRESH_TOKEN) {
    logger.info('[Google Calendar] Using system-wide account to create event.');
    try {
      const oAuth2Client = new google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI);
      oAuth2Client.setCredentials({ refresh_token: SYSTEM_GOOGLE_REFRESH_TOKEN });
      const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
      return await insertEvent(calendar);
    } catch (error) {
      logger.error(`[Google Calendar] Error with system-wide account: ${error.message}. Falling back to simulation.`);
      const mock = await createMockEvent({ summary, description, startDateTime, endDateTime, attendeesEmails });
      return { event: mock, simulated: true, error: `Falha na API do Google Calendar: ${error.message}` };
    }
  }

  logger.warn('[Google Calendar] No user or system refresh token found. Simulating event creation.');
  const mock = await createMockEvent({ summary, description, startDateTime, endDateTime, attendeesEmails });
  return { event: mock, simulated: true, error: "Nenhuma credencial de usuário ou do sistema foi encontrada." };
}


module.exports = { createEvent };
