const { sendEmail } = require('../services/emailService');

async function sendVerificationEmail(user, token) {
  const verificationLink = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;

  const subject = 'Confirme seu email na QualifAI';

  const html = `
    <p>Olá ${user.name},</p>
    <p>Obrigado por se registrar na QualifAI! Para ativar sua conta, por favor confirme seu email clicando no link abaixo:</p>
    <p><a href="${verificationLink}">Confirmar Email</a></p>
    <p>Se você não criou esta conta, por favor ignore este email.</p>
    <hr>
    <p>Atenciosamente,</p>
    <p>Equipe QualifAI</p>
  `;

  try {
    const result = await sendEmail({
      to: user.email,
      subject,
      html,
    }, user.settings);

    return result;
  } catch (error) {
    console.error('Erro ao enviar email de verificação:', error);
    throw error;
  }
}

module.exports = { sendVerificationEmail };
