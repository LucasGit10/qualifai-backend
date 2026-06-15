
const mockData = {
  User: [
    {
      _id: '5f7d1b2e3a4c5d6e7f8a9b0c', // Valid hex ID
      name: 'Admin Test',
      email: 'admin@test.com',
      password: 'hashed_password',
      role: 'admin',
      plan: 'pro',
      company: { name: 'QualifAI Corp', domain: 'qualif-ai.com' },
      taxId: { type: 'CNPJ', number: '12345678000199' },
      settings: {
        theme: 'dark',
        aiConfig: { agentName: 'Mock Agent' },
        integrations: {
          whatsappProvider: 'whatsapp' // Fixed the "undefined" provider warning
        }
      },
      isActive: true,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ],
  Lead: [
    {
      _id: '5f7d1b2e3a4c5d6e7f8a9b0d',
      name: 'João Silva',
      email: 'joao@cliente.com',
      phone: '11999998888',
      company: 'Silva Logística',
      source: 'linkedin',
      status: 'novo',
      user: '5f7d1b2e3a4c5d6e7f8a9b0c',
      value: 15000,
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      _id: '5f7d1b2e3a4c5d6e7f8a9b0e',
      name: 'Maria Oliveira',
      email: 'maria@empresa.com',
      phone: '21988887777',
      company: 'Oliveira Soluções',
      source: 'form',
      status: 'qualificado',
      user: '5f7d1b2e3a4c5d6e7f8a9b0c',
      value: 45000,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ],
  Debt: [
    {
      _id: '5f7d1b2e3a4c5d6e7f8a9b0f',
      lead: '5f7d1b2e3a4c5d6e7f8a9b0d',
      contractNumber: 'CTR-2024-001',
      originalAmount: 10000,
      currentBalance: 8500,
      status: 'ativo',
      user: '5f7d1b2e3a4c5d6e7f8a9b0c',
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ],
  Campaign: [
    {
      _id: '5f7d1b2e3a4c5d6e7f8a9b10',
      name: 'Campanha de Reativação',
      user: '5f7d1b2e3a4c5d6e7f8a9b0c',
      channel: 'whatsapp',
      status: 'running',
      stats: { total: 100, sent: 50, delivered: 45, read: 30, replied: 5, failed: 5 },
      createdAt: new Date(),
      updatedAt: new Date(),
      contacts: [
        { _id: '5f7d1b2e3a4c5d6e7f8a9b11', name: 'Contato 1', phone: '11999998888', status: 'sent', sentAt: new Date() }
      ]
    }
  ],
  Column: [
    { _id: '5f7d1b2e3a4c5d6e7f8a9b12', title: '📋 To Do', position: 0, board: '5f7d1b2e3a4c5d6e7f8a9b15', user: '5f7d1b2e3a4c5d6e7f8a9b0c', items: [] },
    { _id: '5f7d1b2e3a4c5d6e7f8a9b13', title: '🚀 In Progress', position: 1, board: '5f7d1b2e3a4c5d6e7f8a9b15', user: '5f7d1b2e3a4c5d6e7f8a9b0c', items: [] },
    { _id: '5f7d1b2e3a4c5d6e7f8a9b14', title: '✅ Done', position: 2, board: '5f7d1b2e3a4c5d6e7f8a9b15', user: '5f7d1b2e3a4c5d6e7f8a9b0c', items: [] }
  ],
  Card: [
    { _id: '5f7d1b2e3a4c5d6e7f8a9b16', title: 'Reunião com João', description: 'Discutir contrato CTR-2024-001', columnId: '5f7d1b2e3a4c5d6e7f8a9b12', user: '5f7d1b2e3a4c5d6e7f8a9b0c', position: 0, priority: 'Alta' }
  ],
  Board: [
    { _id: '5f7d1b2e3a4c5d6e7f8a9b15', name: 'Meu Kanban Board', user: '5f7d1b2e3a4c5d6e7f8a9b0c', columns: ['5f7d1b2e3a4c5d6e7f8a9b12', '5f7d1b2e3a4c5d6e7f8a9b13', '5f7d1b2e3a4c5d6e7f8a9b14'] }
  ],
  Guarantor: [
    { _id: '5f7d1b2e3a4c5d6e7f8a9b17', name: 'Sócio Fiador', email: 'fiador@test.com', phone: '11999990000', debt: '5f7d1b2e3a4c5d6e7f8a9b0f', user: '5f7d1b2e3a4c5d6e7f8a9b0c' }
  ],
  MessageTemplate: [
    { _id: '5f7d1b2e3a4c5d6e7f8a9b18', name: 'Abordagem Inicial', content: 'Olá {{name}}, tudo bem?', channel: 'whatsapp', user: '5f7d1b2e3a4c5d6e7f8a9b0c' }
  ],
  Installment: [
    // 2023
    { _id: '5f7d1b2e3a4c5d6e7f8a9b19', debt: '5f7d1b2e3a4c5d6e7f8a9b0f', userId: '5f7d1b2e3a4c5d6e7f8a9b0c', user: '5f7d1b2e3a4c5d6e7f8a9b0c', amount: 1500, paidAmount: 1500, status: 'pago', dueDate: new Date('2023-01-15'), paymentDate: new Date('2023-01-14') },
    { _id: '5f7d1b2e3a4c5d6e7f8a9b1a', debt: '5f7d1b2e3a4c5d6e7f8a9b0f', userId: '5f7d1b2e3a4c5d6e7f8a9b0c', user: '5f7d1b2e3a4c5d6e7f8a9b0c', amount: 1500, paidAmount: 1500, status: 'pago', dueDate: new Date('2023-02-15'), paymentDate: new Date('2023-02-16') },
    { _id: '5f7d1b2e3a4c5d6e7f8a9b1b', debt: '5f7d1b2e3a4c5d6e7f8a9b0f', userId: '5f7d1b2e3a4c5d6e7f8a9b0c', user: '5f7d1b2e3a4c5d6e7f8a9b0c', amount: 1500, paidAmount: 0, status: 'atrasado', dueDate: new Date('2023-03-15') },
    // 2024
    { _id: '5f7d1b2e3a4c5d6e7f8a9b1c', debt: '5f7d1b2e3a4c5d6e7f8a9b0f', userId: '5f7d1b2e3a4c5d6e7f8a9b0c', user: '5f7d1b2e3a4c5d6e7f8a9b0c', amount: 2000, paidAmount: 2000, status: 'pago', dueDate: new Date('2024-01-10'), paymentDate: new Date('2024-01-10') },
    { _id: '5f7d1b2e3a4c5d6e7f8a9b1d', debt: '5f7d1b2e3a4c5d6e7f8a9b0f', userId: '5f7d1b2e3a4c5d6e7f8a9b0c', user: '5f7d1b2e3a4c5d6e7f8a9b0c', amount: 2000, paidAmount: 0, status: 'pendente', dueDate: new Date('2024-04-10') },
    { _id: '5f7d1b2e3a4c5d6e7f8a9b1e', debt: '5f7d1b2e3a4c5d6e7f8a9b0f', userId: '5f7d1b2e3a4c5d6e7f8a9b0c', user: '5f7d1b2e3a4c5d6e7f8a9b0c', amount: 2500, paidAmount: 2500, status: 'pago', dueDate: new Date('2024-02-20'), paymentDate: new Date('2024-02-22') },
    // 2025
    { _id: '5f7d1b2e3a4c5d6e7f8a9b1f', debt: '5f7d1b2e3a4c5d6e7f8a9b0f', userId: '5f7d1b2e3a4c5d6e7f8a9b0c', user: '5f7d1b2e3a4c5d6e7f8a9b0c', amount: 3000, paidAmount: 0, status: 'pendente', dueDate: new Date('2025-01-05') }
  ],
  Notification: [
    {
      _id: '5f7d1b2e3a4c5d6e7f8a9b20',
      user: '5f7d1b2e3a4c5d6e7f8a9b0c',
      title: 'Lembrete de Cobrança',
      message: 'O contrato CTR-2024-001 possui parcelas vencendo amanhã.',
      type: 'event_reminder',
      priority: 'high',
      isRead: false,
      createdAt: new Date()
    },
    {
      _id: '5f7d1b2e3a4c5d6e7f8a9b21',
      user: '5f7d1b2e3a4c5d6e7f8a9b0c',
      title: 'Reunião Agendada',
      message: 'Nova reunião com João Silva para discussão de dívida.',
      type: 'meeting_scheduled',
      priority: 'medium',
      isRead: false,
      createdAt: new Date(),
      event: {
        start: new Date(Date.now() + 3600000), // Em 1 hora
        meetLink: 'https://meet.google.com/abc-defg-hij'
      }
    }
  ]
};

module.exports = mockData;
