const path = require('path');
const { createEvent } = require('../services/googleCalendarServices');
const { sendEmail } = require('../services/emailService');
const logger = require('../utils/logger');

async function scheduleDemo(req, res) {
  try {
    const { summary, description, startDateTime, endDateTime, attendeesEmails } = req.body;

    logger.info('[scheduleDemo] Início do agendamento de demonstração', { summary, startDateTime, endDateTime, attendeesEmails });

    if (!summary || !startDateTime || !endDateTime || !attendeesEmails?.length) {
      logger.warn('[scheduleDemo] Parâmetros obrigatórios faltando', {
        summary,
        startDateTime,
        endDateTime,
        attendeesEmails
      });
      return res.status(400).json({ error: 'Parâmetros obrigatórios faltando' });
    }

    logger.info('[scheduleDemo] Criando evento no Google Calendar...');
    const calendarResponse = await createEvent({ summary, description, startDateTime, endDateTime, attendeesEmails });
    const event = calendarResponse.event; // Extrai o objeto do evento aninhado

    const meetLink = event?.hangoutLink || event?.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri;
    logger.info('[scheduleDemo] Evento criado com sucesso', { meetLink });

    const logoPath = path.join(__dirname, '../assets/QualifaiLogo.png');
    const emailSubject = `📅 Convite para demonstração: ${summary}`;
    const emailText = `
      Você foi convidado para a demonstração "${summary}".
      Descrição: ${description || 'Sem descrição'}
      Início: ${startDateTime}
      Término: ${endDateTime}
      Link: ${meetLink || 'Link não disponível'}
    `;
    const emailHtml = `
      <div style="font-family: Arial, sans-serif; color: #333; padding: 20px;">
        <div style="text-align: center; margin-bottom: 20px;">
          <img src="cid:logo_cid" alt="Logo" style="max-height: 60px;" />
        </div>
        <h2>📅 Convite para Demonstração</h2>
        <p><strong>Título:</strong> ${summary}</p>
        <p><strong>Descrição:</strong> ${description || 'Sem descrição'}</p>
        <p><strong>Início:</strong> ${new Date(startDateTime).toLocaleString()}</p>
        <p><strong>Término:</strong> ${new Date(endDateTime).toLocaleString()}</p>
        <p><strong>Link do Google Meet:</strong> <a href="${meetLink}" target="_blank">${meetLink || 'Link não disponível'}</a></p>
        <p style="margin-top: 30px;">Esperamos você lá! 👋</p>
      </div>
    `;

    const attachments = [
      {
        filename: 'logo.png',
        path: logoPath,
        cid: 'logo_cid'
      }
    ];

    logger.info('[scheduleDemo] Enviando emails para os participantes...');
    for (const email of attendeesEmails) {
      logger.info(`[scheduleDemo] Enviando e-mail para: ${email}`);
      await sendEmail({
        to: email,
        subject: emailSubject,
        text: emailText,
        html: emailHtml,
        attachments
      });
      logger.info(`[scheduleDemo] E-mail enviado com sucesso para: ${email}`);
    }

    logger.info('[scheduleDemo] Todos os e-mails enviados com sucesso.');

    return res.status(201).json({ message: 'Demonstração agendada e e-mails enviados com sucesso!', event });
  } catch (error) {
    logger.error('[scheduleDemo] Erro ao agendar demonstração:', error);
    return res.status(500).json({ error: 'Erro ao agendar demonstração' });
  }
}

module.exports = { scheduleDemo };