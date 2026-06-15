const emailService = require('../../services/emailService');
const logger = require('../../utils/logger');

class SupportController {
  async sendMessage(req, res) {
    try {
      const { subject, message } = req.body;
      const user = req.user;

      const supportEmail = process.env.SUPPORT_EMAIL || 'contato@qualifai.tech';

      const emailHtml = `
        <h3>Nova Mensagem de Suporte - QualifAI</h3>
        <p><strong>Usuário:</strong> ${user.name} (${user.email})</p>
        <p><strong>Empresa:</strong> ${user.company?.name || 'Não informada'}</p>
        <p><strong>Assunto:</strong> ${subject}</p>
        <hr>
        <h4>Mensagem:</h4>
        <p style="white-space: pre-wrap;">${message}</p>
      `;

      const emailText = `
        Nova Mensagem de Suporte - QualifAI\n
        Usuário: ${user.name} (${user.email})\n
        Empresa: ${user.company?.name || 'Não informada'}\n
        Assunto: ${subject}\n
        ------------------------------------------\n
        Mensagem:\n
        ${message}
      `;
      
      // A chamada ao emailService agora usa a configuração padrão do sistema como fallback,
      // pois não estamos passando um segundo argumento com 'userSettings'.
      await emailService.sendEmail({
        to: supportEmail,
        subject: `[Suporte QualifAI] - ${subject}`,
        html: emailHtml,
        text: emailText,
        replyTo: user.email
      });
      
      logger.info(`Mensagem de suporte enviada com sucesso por ${user.email}`);
      res.json({ success: true, message: 'Mensagem de suporte enviada com sucesso.' });
    } catch (error) {
      logger.error('Erro ao enviar mensagem de suporte:', error);
      res.status(500).json({ message: 'Erro interno do servidor ao enviar a mensagem.' });
    }
  }
}


module.exports = new SupportController();