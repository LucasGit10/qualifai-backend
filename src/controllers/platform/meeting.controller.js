const path = require('path');
const { createEvent } = require('../../services/googleCalendarServices');
const { sendEmail } = require('../../services/emailService');
const logger = require('../../utils/logger');

async function scheduleMeeting(req, res) {
  try {
    const { summary, description, startDateTime, endDateTime, attendeesEmails } = req.body;

    logger.info('[scheduleMeeting] Início do agendamento de reunião', { summary, startDateTime, endDateTime, attendeesEmails });

    if (!summary || !startDateTime || !endDateTime || !attendeesEmails?.length) {
      logger.warn('[scheduleMeeting] Parâmetros obrigatórios faltando', {
        summary,
        startDateTime,
        endDateTime,
        attendeesEmails
      });
      return res.status(400).json({ error: 'Parâmetros obrigatórios faltando' });
    }

    logger.info('[scheduleMeeting] Criando evento no Google Calendar...');
    const calendarResponse = await createEvent({ summary, description, startDateTime, endDateTime, attendeesEmails });
    const event = calendarResponse.event; // Extrai o objeto do evento aninhado

    const meetLink = event?.hangoutLink || event?.conferenceData?.entryPoints?.find(ep => ep.entryPointType === 'video')?.uri;
    logger.info('[scheduleMeeting] Evento criado com sucesso', { meetLink });

    const logoPath = path.join(__dirname, '../../assets/QualifaiLogo.png');
    const emailSubject = `📅 Convite para reunião: ${summary}`;
    const emailText = `
      Você foi convidado para a reunião "${summary}".
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
        <h2>📅 Convite para Reunião</h2>
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

    logger.info('[scheduleMeeting] Enviando emails para os participantes...');
    for (const email of attendeesEmails) {
      logger.info(`[scheduleMeeting] Enviando e-mail para: ${email}`);
      await sendEmail({
        to: email,
        subject: emailSubject,
        text: emailText,
        html: emailHtml,
        attachments
      });
      logger.info(`[scheduleMeeting] E-mail enviado com sucesso para: ${email}`);
    }

    logger.info('[scheduleMeeting] Todos os e-mails enviados com sucesso.');

    return res.status(201).json({ message: 'Reunião agendada e e-mails enviados com sucesso!', event });
  } catch (error) {
    logger.error('[scheduleMeeting] Erro ao agendar reunião:', error);
    return res.status(500).json({ error: 'Erro ao agendar reunião' });
  }
}

module.exports = { scheduleMeeting };