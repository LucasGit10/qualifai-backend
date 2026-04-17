/**
 * SocketHub - Centralizador de instância Socket.io para evitar dependências circulares.
 */
let io = null;

module.exports = {
  init: (serverInstance) => {
    const { Server } = require('socket.io');
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:3002',
      'http://127.0.0.1:3000',
      'http://127.0.0.1:3001',
      'https://www.qualifai.tech',
      'https://qualifai.tech'
    ];

    io = new Server(serverInstance, {
      cors: {
        origin: (origin, callback) => {
          // Permite qualquer porta no localhost ou se a origem estiver na lista
          if (!origin || origin.includes('localhost') || origin.includes('127.0.0.1') || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'));
          }
        },
        methods: ["GET", "POST"],
        credentials: true
      }
    });

    console.log('✅ SocketHub inicializado com sucesso.');
    return io;
  },
  getIO: () => {
    if (!io) {
      // console.warn('⚠️ SocketHub: io ainda não foi inicializado.');
    }
    return io;
  }
};
