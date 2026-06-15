const { sendEmail } = require('../services/emailService');

async function sendPasswordResetEmail(user, resetToken) {
  const resetLink = `${process.env.FRONTEND_URL}/reset-password?token=${resetToken}`;
  const subject = 'Recuperação de senha - QualifAI';

  const html = `
    <p>Olá ${user.name},</p>
    <p>Recebemos uma solicitação para redefinir sua senha. Clique no link abaixo para criar uma nova senha:</p>
    <p><a href="${resetLink}">Redefinir senha</a></p>
    <p>Se você não solicitou essa alteração, ignore este email.</p>
    <hr>
    <p>Atenciosamente,</p>
    <p>Equipe QualifAI</p>
  `;

  await sendEmail({ to: user.email, subject, html });
}

module.exports = { sendPasswordResetEmail };
