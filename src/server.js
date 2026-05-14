const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { createServer } = require('http');
const { Server } = require('socket.io');
const { WebSocketServer } = require('ws');
const cookieParser = require('cookie-parser');
require('dotenv').config();
const cron = require('node-cron');
const { URL } = require('url');
const path = require('path');

const connectDB = require('./config/database');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const followupService = require('./services/followupService');
const campaignFollowupService = require('./services/campaignFollowupService');
const performanceReportService = require('./services/performanceReportService');
const leadLifecycleService = require('./services/leadLifecycleService');
const debtAutomationService = require('./services/debtAutomationService');
const autoSeed = require('./utils/autoSeed');
const socketHub = require('./utils/socketHub');
const handleVoiceConnection = require('./services/voiceAgentService');

// ── Routes: AI ────────────────────────────────────────────────────────────────
const aiRoutes              = require('./routes/ai/ai.routes');
const aiTrainingRoutes      = require('./routes/ai/training.routes');
const landingAIRouter       = require('./routes/ai/landing.routes');
const voiceAgentRoutes      = require('./routes/ai/voice-agent.routes');

// ── Routes: Auth ──────────────────────────────────────────────────────────────
const authRoutes            = require('./routes/auth/auth.routes');
const adminRoutes           = require('./routes/auth/admin.routes');
const managerRoutes         = require('./routes/auth/manager.routes');

// ── Routes: Collections ───────────────────────────────────────────────────────
const debtRoutes            = require('./routes/collections/debt.routes');
const leadRoutes            = require('./routes/collections/lead.routes');
const campaignRoutes        = require('./routes/collections/campaign.routes');
const kanbanRoutes          = require('./routes/collections/kanban.routes');
const spreadsheetRoutes     = require('./routes/collections/spreadsheet.routes');

// ── Routes: Conversations ─────────────────────────────────────────────────────
const conversationRoutes    = require('./routes/conversations/conversation.routes');
const whatsAppAiRoutes      = require('./routes/conversations/whatsapp-ai.routes');
const whatsappRoute         = require('./routes/conversations/whatsapp-instance.routes');
const instagramRoutes       = require('./routes/conversations/instagram.routes');
const messageTemplate       = require('./routes/conversations/message-template.routes');
const zapiRoutes            = require('./routes/conversations/zapi.routes');

// ── Routes: Integrations ──────────────────────────────────────────────────────
const integrationRoutes     = require('./routes/integrations/integration.routes');
const evolutionRoutes       = require('./routes/integrations/evolution.routes');
const lushaRoutes           = require('./routes/integrations/lusha.routes');

// ── Routes: Platform ──────────────────────────────────────────────────────────
const dashboardRoutes       = require('./routes/platform/dashboard.routes');
const calendarRoutes        = require('./routes/platform/calendar.routes');
const meetingRoutes         = require('./routes/platform/meeting.routes');
const notificationRoutes    = require('./routes/platform/notification.routes');
const rankingRoutes         = require('./routes/platform/ranking.routes');
const performanceReportRoutes = require('./routes/platform/performance-report.routes');
const supportRoutes         = require('./routes/platform/support.routes');
const webhookRoutes         = require('./routes/platform/webhooks.routes');

// ── Routes: Billing ───────────────────────────────────────────────────────────
const paymentRoutes         = require('./routes/billing/payment.routes');
const demoRoutes            = require('./routes/billing/demo.routes');
const blogRoutes            = require('./routes/billing/blog.routes');

// ── Controller direto (necessário antes do middleware JSON) ───────────────────
const paymentController     = require('./controllers/billing/payment.controller');


const app = express();
const PORT = process.env.PORT || 3001;
app.set('trust proxy', 1);
const server = createServer(app);

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:3002',
  'https://www.qualifai.tech',
  'https://qualifai.tech',
  'https://www.qualifaitech.com',
  'https://qualifaitech.com',
  'http://www.qualifaitech.com',
  'http://qualifaitech.com',
  'http://68.183.144.33', // IP do seu Frontend atual
  'http://qualifai-dev-alb-1329034245.us-east-1.elb.amazonaws.com',
];

const limiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), paymentController.handleWebhook);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(helmet());
app.use(cors({
  origin: function(origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('Origin not allowed by CORS'));
    }
  },
  credentials: true
}));
app.options('*', cors());

app.use((req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
});

// Corrigido para apontar para 'public/uploads'
const publicUploadsPath = path.join(__dirname, '..', 'public/uploads');
app.use('/uploads', express.static(publicUploadsPath));
app.use('/api/uploads', express.static(publicUploadsPath));

// Assets de templates commitados no repositório (persistem entre deploys)
const templateAssetsPath = path.join(__dirname, '..', 'public/template-assets');
app.use('/uploads', express.static(templateAssetsPath));
app.use('/api/uploads', express.static(templateAssetsPath));

// Inicializa o Socket.io via Hub (evita dependência circular)
const io = socketHub.init(server);
app.set('io', io);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
    try {
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (url.pathname === '/twilio-stream') {
            wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
        } else {
            socket.destroy();
        }
    } catch (error) {
        logger.error('Error during WebSocket upgrade:', error);
        socket.destroy();
    }
});

wss.on('connection', (ws, request) => {
  logger.info('New Twilio WebSocket connection established.');
  handleVoiceConnection(ws, io);
});
// Exportação removida para usar socketHub.getIO() nos serviços
module.exports = { app, server };

io.on('connection', (socket) => {
  logger.info(`[Socket] Novo cliente conectado: ${socket.id}`);
  socket.on('join-room', (room) => {
    logger.info(`[Socket] Cliente ${socket.id} entrou na sala: ${room}`);
    socket.join(room);
  });
  socket.on('disconnect', (reason) => {
    logger.info(`[Socket] Cliente ${socket.id} desconectado. Motivo: ${reason}`);
  });
});

if (process.env.USE_MOCK_DATA === 'true') {
  logger.info('🚀 Mock Mode Enabled: Skipping real DB connection');
} else {
  connectDB().then(() => {
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
      autoSeed();
    }
  });
}

// ── AI ────────────────────────────────────────────────────────────────────────
app.use('/api/ai',          aiRoutes);
app.use('/api/ai-training', aiTrainingRoutes);
app.use('/api/landing-ai',  landingAIRouter);
app.use('/api/voice-agent', voiceAgentRoutes);

// ── Auth ──────────────────────────────────────────────────────────────────────
app.use('/api/auth',    authRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/manager', managerRoutes);

// ── Collections ───────────────────────────────────────────────────────────────
app.use('/api/debts',        debtRoutes);
app.use('/api/leads',        leadRoutes);
app.use('/api/campaigns',    campaignRoutes);
app.use('/api/kanban',       kanbanRoutes);
app.use('/api/spreadsheets', spreadsheetRoutes);

// ── Conversations ─────────────────────────────────────────────────────────────
app.use('/api/conversations',    conversationRoutes);
app.use('/api/whatsapp-ai',      whatsAppAiRoutes);
app.use('/api/whatsapp',         whatsappRoute);
app.use('/api/instagram',        instagramRoutes);
app.use('/api/template-message', messageTemplate);
app.use('/api/zapi',             zapiRoutes);

// ── Integrations ──────────────────────────────────────────────────────────────
app.use('/api/integrations', integrationRoutes);
app.use('/api/evolution',    evolutionRoutes);
app.use('/api/lusha',        lushaRoutes);

// ── Platform ──────────────────────────────────────────────────────────────────
app.use('/api/dashboard',      dashboardRoutes);
app.use('/api/calendar',       calendarRoutes);
app.use('/api/meetings',       meetingRoutes);
app.use('/api/notifications',  notificationRoutes);
app.use('/api/ranking',        rankingRoutes);
app.use('/api/reports',        performanceReportRoutes);
app.use('/api/support',        supportRoutes);
app.use('/api/webhooks',       webhookRoutes);

// ── Billing ───────────────────────────────────────────────────────────────────
app.use('/api/payments', paymentRoutes);
app.use('/api/demo',     demoRoutes);
app.use('/api/blog',     blogRoutes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

const isDev = process.env.NODE_ENV === 'development' || process.env.USE_MOCK_DATA === 'true';

cron.schedule(isDev ? '*/5 * * * *' : '* * * * *', () => {
  followupService.checkAndSendFollowups();
  campaignFollowupService.processCampaignFollowups();
});

cron.schedule('0 8 * * *', () => {
  performanceReportService.generateAndSendReports();
}, { scheduled: true, timezone: "America/Sao_Paulo" });

cron.schedule(isDev ? '*/10 * * * *' : '*/10 * * * * *', () => {
  leadLifecycleService.processInactiveLeads();
}, { scheduled: true, timezone: "America/Sao_Paulo" });

// Rotina de Cobrança (Diária às 09:00)
cron.schedule('0 9 * * *', () => {
  debtAutomationService.processBillingRoutine();
}, { scheduled: true, timezone: "America/Sao_Paulo" });

const serverInstance = server.listen(PORT,  '0.0.0.0',() => {
  logger.info(`Servidor rodando na porta ${PORT}`);
});

// Aumenta o timeout para 10 minutos para processar planilhas grandes
serverInstance.timeout = 600000;
serverInstance.keepAliveTimeout = 610000;
serverInstance.headersTimeout = 620000;
