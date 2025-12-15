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
const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads');
const conversationRoutes = require('./routes/conversations');
const aiRoutes = require('./routes/ai');
const integrationRoutes = require('./routes/integrations');
const dashboardRoutes = require('./routes/dashboard');
const webhookRoutes = require('./routes/webhooks');
const evolutionRoutes = require('./routes/evolution');
const zapiRoutes = require('./routes/zapi');
const errorHandler = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const demoRoutes = require('./routes/demo');
const kanbanRoutes = require('./routes/kanban');
const supportRoutes = require('./routes/support');
const calendarRoutes = require('./routes/calendar');
const whatsappRoute = require('./routes/whatsappInstance');
const landingAIRouter = require('./routes/landingAI');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payment');
const paymentController = require('./controllers/paymentController');
const campaignRoutes = require('./routes/campaigns');
const followupService = require('./services/followupService');
const messageTemplate = require('./routes/messageTemplate');
const voiceAgentRoutes = require('./routes/voiceAgent');
const handleVoiceConnection = require('./services/voiceAgentService');
const whatsAppAiRoutes = require('./routes/whatsappAi');
const managerRoutes = require('./routes/manager');
const rankingRoutes = require('./routes/ranking');
const instagramRoutes = require('./routes/instagram')
const campaignFollowupService = require('./services/campaignFollowupService');
const performanceReportService = require('./services/performanceReportService');
const blogRoutes = require('./routes/blog');
const performanceReportRoutes = require('./routes/performanceReport');
const leadLifecycleService = require('./services/leadLifecycleService');
const lushaRotes = require('./routes/lusha');

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
app.use('/uploads', express.static(path.join(__dirname, '..', 'public/uploads')));

const io = new Server(server, { cors: { origin: allowedOrigins } });
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
module.exports.io = io;

io.on('connection', (socket) => {
  socket.on('join-room', (room) => socket.join(room));
  socket.on('disconnect', () => {});
});

connectDB();

app.use('/api/webhooks', webhookRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/integrations', integrationRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/demo', demoRoutes);
app.use('/api/kanban', kanbanRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/landing-ai', landingAIRouter);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/whatsapp', whatsappRoute);
app.use('/api/evolution', evolutionRoutes);
app.use('/api/zapi', zapiRoutes);
app.use('/api/template-message', messageTemplate);
app.use('/api/voice-agent', voiceAgentRoutes);
app.use('/api/reports', performanceReportRoutes);
app.use('/api/blog', blogRoutes);
app.use('/api/whatsapp-ai', whatsAppAiRoutes);
app.use('/api/manager', managerRoutes);
app.use('/api/ranking', rankingRoutes);
app.use('/api/instagram', instagramRoutes);
app.use('/api/lusha', lushaRotes);

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

app.use(errorHandler);

cron.schedule('* * * * *', () => {
  followupService.checkAndSendFollowups();
  campaignFollowupService.processCampaignFollowups();
});

cron.schedule('0 8 * * *', () => {
  performanceReportService.generateAndSendReports();
}, { scheduled: true, timezone: "America/Sao_Paulo" });

cron.schedule('*/10 * * * * *', () => {
  leadLifecycleService.processInactiveLeads();
}, { scheduled: true, timezone: "America/Sao_Paulo" });

server.listen(PORT,  '0.0.0.0',() => {
  logger.info(`Servidor rodando na porta ${PORT}`);
});