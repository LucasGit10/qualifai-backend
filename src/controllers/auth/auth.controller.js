const { getModel } = require('../../utils/modelProvider');
const User = getModel('User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const { sendVerificationEmail } = require('../../utils/emailVerification');
const { sendPasswordResetEmail } = require('../../utils/passwordResetEmail');
const logger = require('../../utils/logger');

class AuthController {
  // Registro de usuário
  async register(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const { name, email, password, company, taxId } = req.body;

      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ message: 'O email já está em uso' });
      }

      if (taxId && taxId.number) {
        const existingTaxId = await User.findOne({ 'taxId.number': taxId.number });
        if (existingTaxId) {
          return res.status(400).json({ message: 'O CPF/CNPJ já está em uso' });
        }
      }

      const user = new User({
        name,
        email,
        password,
        company,
        taxId,
        role: 'manager', // New users default to manager
        emailVerified: false,
      });

      await user.save();

      const authToken = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );

      const emailToken = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );

      await sendVerificationEmail(user, emailToken);

      const userResponse = user.toObject();
      delete userResponse.password;

      // Armazena token JWT no cookie HTTP
      res.cookie('authToken', authToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // Changed from 'strict'
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 dias em ms
      });

      res.status(201).json({
        success: true,
        user: userResponse,
        token: authToken,
        message: 'Usuário criado. Verifique seu email para ativar a conta.'
      });

    } catch (error) {
      logger.error('Erro no registo:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async login(req, res) {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
  
      const { email, password } = req.body;
  
      const user = await User.findOne({ email }).select('+password');
      if (!user) {
        return res.status(401).json({ message: 'Credenciais inválidas' });
      }
  
      const isMatch = await user.comparePassword(password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Credenciais inválidas' });
      }

      if (!user.emailVerified) {
        return res.status(403).json({ message: 'Conta não confirmada. Por favor, verifique seu email.' });
      }
  
      const token = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '7d' }
      );
  
      const userResponse = user.toObject();
      delete userResponse.password;
  
      res.cookie('authToken', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // Changed from 'strict'
        maxAge: 7 * 24 * 60 * 60 * 1000
      });
  
      res.json({
        success: true,
        user: userResponse,
        token
      });
  
    } catch (error) {
      logger.error('Erro no login:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }


  async verifyEmail(req, res) {
    const { token } = req.query;
    if (!token) {
      return res.status(400).json({ message: 'Token é obrigatório' });
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const userId = decoded.id;

      // Buscar usuário
      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado' });
      }

      if (user.emailVerified) {
        return res.status(400).json({ message: 'Email já confirmado' });
      }

      user.emailVerified = true;
      await user.save();

      return res.json({ success: true, message: 'Email confirmado com sucesso!' });
    } catch (error) {
      if (error.name === 'TokenExpiredError') {
        return res.status(400).json({ message: 'Token expirado. Solicite um novo email de verificação.' });
      }
      return res.status(400).json({ message: 'Token inválido.' });
    }
  }

  async resendConfirmationEmail(req, res) {
    try {
      const { email } = req.body;

      if (!email) {
        return res.status(400).json({ message: 'Email é obrigatório' });
      }

      const user = await User.findOne({ email });
      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado' });
      }

      if (user.emailVerified) {
        return res.status(400).json({ message: 'Email já confirmado' });
      }

      const emailToken = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '1d' }
      );

      await sendVerificationEmail(user, emailToken);

      res.json({ success: true, message: 'Email de confirmação reenviado com sucesso' });
    } catch (error) {
      logger.error('Erro no reenvio do email de confirmação:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // 1. Solicitar recuperação de senha - envia email com link
  async requestPasswordReset(req, res) {
    // DEBUG: Log de início da função
    logger.info(`[Auth] Iniciando requestPasswordReset...`);
    try {
      const { email } = req.body;
      if (!email) {
        return res.status(400).json({ message: 'Email é obrigatório' });
      }
      
      // DEBUG: Log do email recebido
      logger.info(`[Auth] Solicitação de reset para o email: ${email}`);

      const user = await User.findOne({ email });
      if (!user) {
        // DEBUG: Log para o caso de usuário não encontrado (importante para segurança)
        logger.warn(`[Auth] Usuário com email "${email}" não encontrado. Enviando resposta padrão por segurança.`);
        return res.json({ success: true, message: 'Se o email existir, um link para recuperação será enviado.' });
      }

      // DEBUG: Log de usuário encontrado
      logger.info(`[Auth] Usuário encontrado. ID: ${user._id}. Gerando token de reset...`);

      const resetToken = jwt.sign(
        { id: user._id },
        process.env.JWT_SECRET,
        { expiresIn: '1h' }
      );

      // DEBUG: Log antes de chamar o serviço de email
      logger.info(`[Auth] Token gerado. Tentando enviar email de recuperação para ${user.email}...`);
      await sendPasswordResetEmail(user, resetToken);

      // DEBUG: Log de sucesso no envio
      logger.info(`[Auth] Email de recuperação provavelmente enviado. Finalizando a requisição.`);
      res.json({ success: true, message: 'Se o email existir, um link para recuperação será enviado.' });

    } catch (error) {
      // DEBUG: Log de erro aprimorado
      logger.error(`[Auth] Falha crítica em requestPasswordReset para o email: ${req.body.email}`, error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // 2. Resetar senha usando token e nova senha
  async resetPassword(req, res) {
    // DEBUG: Log de início da função
    logger.info(`[Auth] Iniciando resetPassword...`);
    try {
      const { token, newPassword } = req.body;

      // DEBUG: Log para confirmar recebimento dos dados (sem logar a senha)
      logger.info(`[Auth] Recebido token: ${token ? 'Sim' : 'Não'}, Nova Senha: ${newPassword ? 'Sim' : 'Não'}`);

      if (!token || !newPassword) {
        return res.status(400).json({ message: 'Token e nova senha são obrigatórios.' });
      }

      // DEBUG: Log antes da verificação do token
      logger.info(`[Auth] Verificando o token...`);
      let payload;
      try {
        payload = jwt.verify(token, process.env.JWT_SECRET);
        // DEBUG: Log de sucesso na verificação
        logger.info(`[Auth] Token verificado com sucesso. Payload (ID do usuário): ${payload.id}`);
      } catch (err) {
        // DEBUG: Log específico para token inválido/expirado
        logger.warn(`[Auth] Tentativa de reset com token inválido ou expirado.`);
        return res.status(400).json({ message: 'Token inválido ou expirado.' });
      }

      // DEBUG: Log antes da busca no banco de dados
      logger.info(`[Auth] Buscando usuário com ID: ${payload.id}...`);
      const user = await User.findById(payload.id);
      if (!user) {
        // DEBUG: Log para usuário não encontrado a partir de um token válido
        logger.warn(`[Auth] Usuário com ID ${payload.id} (do token) não foi encontrado no banco de dados.`);
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      // DEBUG: Log de usuário encontrado e prestes a salvar a nova senha
      logger.info(`[Auth] Usuário ${user.email} encontrado. Atualizando e salvando a nova senha...`);
      user.password = newPassword;
      await user.save();

      // DEBUG: Log de sucesso final
      logger.info(`[Auth] Senha para o usuário ${user.email} (ID: ${user._id}) foi alterada com sucesso.`);
      res.json({ success: true, message: 'Senha alterada com sucesso.' });

    } catch (error)      {
      // DEBUG: Log de erro aprimorado
      logger.error(`[Auth] Falha crítica em resetPassword:`, error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }


  async deleteAccount(req, res) {
    try {
      const userId = req.user.id; // do middleware auth
      const { currentPassword } = req.body;

      if (!currentPassword) {
        return res.status(400).json({ message: 'A senha atual é obrigatória.' });
      }

      // Buscar usuário
      const user = await User.findById(userId).select('+password');
      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      // Verificar senha
      const isMatch = await bcrypt.compare(currentPassword, user.password);
      if (!isMatch) {
        return res.status(401).json({ message: 'Senha incorreta.' });
      }

      // Excluir usuário
      await User.deleteOne({ _id: userId });

      logger.info(`Conta do usuário ${user.email} excluída com sucesso`);
      return res.json({ success: true, message: 'Conta excluída com sucesso.' });

    } catch (error) {
      logger.error('Erro ao excluir conta:', error);
      return res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  // Perfil do usuário
  async getProfile(req, res) {
    try {
      const user = await User.findById(req.user.id);
      res.json({ user });
    } catch (error) {
      logger.error('Erro ao buscar perfil:', error);
      res.status(500).json({ message: 'Erro ao buscar perfil' });
    }
  }

  // Atualizar perfil

  async updateProfile(req, res) {
    try {
      const updates = req.body;
      delete updates.password; // Ótima prática, não permitir atualização de senha por aqui

      // 1. Busca o usuário primeiro
      const user = await User.findById(req.user.id);

      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado' });
      }

      // 2. Usa o .set() para mesclar (merge) as atualizações
      // O .set() é inteligente, ele vai mesclar o 'settings'
      // em vez de substituí-lo.
      user.set(updates);

      // 3. Salva o documento (e roda os validadores)
      const updatedUser = await user.save({ validateBeforeSave: true });

      res.json({ user: updatedUser }); // Retorna o usuário atualizado
    } catch (error) {
      logger.error('Erro ao atualizar perfil:', error);
      // Adiciona validação de erro do Mongoose
      if (error.name === 'ValidationError') {
        return res.status(400).json({ message: error.message, errors: error.errors });
      }
      res.status(500).json({ message: 'Erro ao atualizar perfil' });
    }
  }

  async getUserTheme(req, res) {
    try {
      const userId = req.user.id; // ID vem do middleware de autenticação

      // Busca o usuário no banco, selecionando APENAS o campo do tema para otimização
      const user = await User.findById(userId).select('settings.theme');

      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      // Extrai o tema. Usa o operador "?." para segurança e define 'dark' como fallback.
      const theme = user.settings?.theme || 'dark';

      // Retorna apenas a informação do tema
      res.json({ theme });

    } catch (error) {
      logger.error('Erro ao buscar preferência de tema do usuário:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
  async updateUserTheme(req, res) {
    try {
      const userId = req.user.id;
      const { theme } = req.body;

      // Validação: Garante que o valor enviado seja apenas 'dark' ou 'light'
      if (!theme || !['dark', 'light'].includes(theme)) {
        return res.status(400).json({ message: 'Valor de tema inválido. Use "dark" ou "light".' });
      }

      // Encontra o usuário e atualiza apenas o campo do tema
      const user = await User.findByIdAndUpdate(
        userId,
        { 'settings.theme': theme },
        { new: true } // Retorna o documento atualizado
      );

      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      logger.info(`Tema do usuário ${user.email} atualizado para ${theme}`);
      res.json({ success: true, message: 'Tema atualizado com sucesso.', theme: user.settings.theme });

    } catch (error) {
      logger.error('Erro ao atualizar preferência de tema do usuário:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }

  async updateConversationView(req, res) {
    try {
      const userId = req.user.id;
      const { view } = req.body;

      // Validação: Garante que o valor enviado seja apenas 'cards' ou 'chat'
      if (!view || !['cards', 'chat'].includes(view)) {
        return res.status(400).json({ message: 'Valor de visualização inválido. Use "cards" ou "chat".' });
      }

      // Encontra o usuário e atualiza o campo conversationView
      const user = await User.findByIdAndUpdate(
        userId,
        { 'settings.conversationView': view },
        { new: true } // Retorna o documento atualizado
      );

      if (!user) {
        return res.status(404).json({ message: 'Usuário não encontrado.' });
      }

      logger.info(`Modo de visualização para o usuário ${user.email} atualizado para ${view}`);
      res.json({ success: true, message: 'Modo de visualização atualizado com sucesso.', view: user.settings.conversationView });

    } catch (error) {
      logger.error('Erro ao atualizar o modo de visualização da conversa:', error);
      res.status(500).json({ message: 'Erro interno do servidor' });
    }
  }
}

module.exports = new AuthController();
