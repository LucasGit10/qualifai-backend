const nodemailer = require('nodemailer');
const logger = require('../utils/logger');

const providerSettings = {
  gmail: { host: "smtp.gmail.com", port: 465, secure: true },
  outlook: { host: "smtp-mail.outlook.com", port: 587, secure: false }, // STARTTLS
  yahoo: { host: "smtp.mail.yahoo.com", port: 465, secure: true },
};

async function sendEmail({ to, subject, text, html, replyTo, attachments }, userSettings = null) {
  let effectiveConfig;
  let fromName;

  // prioridade 1: Configuração do usuário
  const userSmtpConfig = userSettings?.integrations?.smtp;
  if (userSmtpConfig && userSmtpConfig.enabled && userSmtpConfig.auth?.user && userSmtpConfig.auth?.pass) {
    effectiveConfig = userSmtpConfig;
    fromName = userSettings.name || 'QualifAI';
  } else {
    // prioridade 2: Configuração padrão do sistema
    if (process.env.DEFAULT_SMTP_USER && process.env.DEFAULT_SMTP_PASS) {
      effectiveConfig = {
        provider: process.env.DEFAULT_SMTP_PROVIDER || 'gmail',
        host: process.env.DEFAULT_SMTP_HOST,
        port: process.env.DEFAULT_SMTP_PORT,
        secure: process.env.DEFAULT_SMTP_SECURE === 'true',
        auth: {
          user: process.env.DEFAULT_SMTP_USER,
          pass: process.env.DEFAULT_SMTP_PASS,
        },
      };
      fromName = 'QualifAI Support';
    }
  }

  // Priority 3: If no valid configuration is found, simulate the email
  if (!effectiveConfig) {
    logger.info('--- SIMULAÇÃO DE ENVIO DE EMAIL (Nenhuma configuração SMTP encontrada) ---');
    logger.info(`Para: ${to}`);
    logger.info(`Assunto: ${subject}`);
    logger.info(`Corpo: ${(html || text || '').substring(0, 150)}...`);
    logger.info('------------------------------------');
    return Promise.resolve({ success: true, messageId: `mock_simulation_${Date.now()}` });
  }

  // Determine transport settings based on provider
  let transportConfig;
  if (effectiveConfig.provider === 'other') {
    if (!effectiveConfig.host || !effectiveConfig.port) {
        throw new Error("Provedor SMTP 'other' selecionado, mas Host e Porta não estão configurados.");
    }
    transportConfig = {
      host: effectiveConfig.host,
      port: effectiveConfig.port,
      secure: effectiveConfig.secure,
    };
  } else {
    transportConfig = providerSettings[effectiveConfig.provider];
  }

  if (!transportConfig) {
    throw new Error(`Provedor SMTP '${effectiveConfig.provider}' não é suportado.`);
  }

  try {
    const transporter = nodemailer.createTransport({
      ...transportConfig,
      auth: {
        user: effectiveConfig.auth.user,
        pass: effectiveConfig.auth.pass,
      },
      tls: {
          rejectUnauthorized: false
      }
    });

    const mailOptions = {
      from: `"${fromName}" <${effectiveConfig.auth.user}>`,
      to,
      subject,
      text: text || (html ? html.replace(/<[^>]*>?/gm, '') : ''),
      html,
      attachments,
    };
    
    if (replyTo) {
      mailOptions.replyTo = replyTo;
    }

    const info = await transporter.sendMail(mailOptions);
    logger.info(`Email enviado com sucesso via SMTP: ${info.messageId}`);
    return { success: true, messageId: info.messageId };
  } catch (error) {
    logger.error("Erro ao enviar email via SMTP:", {
      user: effectiveConfig.auth.user,
      error: error.message
    });
    throw new Error('Falha ao enviar email. Verifique as configurações de SMTP (usuário, senha/senha de app e provedor).');
  }
}

module.exports = { sendEmail };