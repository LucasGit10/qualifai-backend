const { getModel } = require('../utils/modelProvider');
const mongoose = require('mongoose');
const Conversation = getModel('Conversation');

const ROLE_MAP = {
  ai: 'ai',
  assistant: 'ai',
  bot: 'ai',
  human: 'human',
  agent: 'human',
  operator: 'human',
  atendente: 'human',
  lead: 'lead',
  user: 'lead',
  cliente: 'lead',
  customer: 'lead',
  system: 'system'
};

const normalizeMessage = (message = {}, fallbackChannel = 'whatsapp') => ({
  role: ROLE_MAP[String(message.role || '').toLowerCase()] || 'system',
  content: String(message.content || message.text || '[Mensagem sem conteudo]'),
  timestamp: message.timestamp || message.createdAt || new Date(),
  channel: message.channel || fallbackChannel || 'whatsapp',
  metadata: message.metadata || {}
});

const normalizeMessages = (messages = [], fallbackChannel) =>
  (messages || []).map(message => normalizeMessage(message, fallbackChannel));

const openConversationFilter = ({ userId, leadId, channel }) => ({
  user: userId,
  lead: leadId,
  channel,
  status: { $ne: 'closed' }
});

const findReusableConversation = ({ userId, leadId, channel }) => (
  consolidateOpenDuplicates({ userId, leadId, channel })
);

const getLatestDate = (...dates) => {
  const validDates = dates.filter(Boolean).map(date => new Date(date)).filter(date => !Number.isNaN(date.getTime()));
  if (!validDates.length) return undefined;
  return new Date(Math.max(...validDates.map(date => date.getTime())));
};

async function consolidateGroup(conversations) {
  if (!conversations.length) return null;
  const [primary, ...duplicates] = conversations;
  primary.messages = normalizeMessages(primary.messages, primary.channel);
  if (!duplicates.length) return primary;

  const duplicateMessages = duplicates.flatMap(conversation =>
    normalizeMessages(conversation.messages, conversation.channel || primary.channel)
  );
  primary.messages = [...(primary.messages || []), ...duplicateMessages]
    .sort((a, b) => new Date(a.timestamp || a.createdAt || 0) - new Date(b.timestamp || b.createdAt || 0));

  primary.processedMessageIds = [...new Set([
    ...(primary.processedMessageIds || []),
    ...duplicates.flatMap(conversation => conversation.processedMessageIds || [])
  ])];
  primary.processedStatusIds = [...new Set([
    ...(primary.processedStatusIds || []),
    ...duplicates.flatMap(conversation => conversation.processedStatusIds || [])
  ])];

  primary.unreadCount = [primary, ...duplicates].reduce((sum, conversation) => sum + (conversation.unreadCount || 0), 0);
  primary.sentCount = [primary, ...duplicates].reduce((sum, conversation) => sum + (conversation.sentCount || 0), 0);
  primary.deliveredCount = [primary, ...duplicates].reduce((sum, conversation) => sum + (conversation.deliveredCount || 0), 0);
  primary.readCount = [primary, ...duplicates].reduce((sum, conversation) => sum + (conversation.readCount || 0), 0);
  primary.lastMessageAt = getLatestDate(primary.lastMessageAt, ...duplicates.map(conversation => conversation.lastMessageAt));
  primary.lastInboundMessageAt = getLatestDate(primary.lastInboundMessageAt, ...duplicates.map(conversation => conversation.lastInboundMessageAt));
  primary.lastOutboundMessageAt = getLatestDate(primary.lastOutboundMessageAt, ...duplicates.map(conversation => conversation.lastOutboundMessageAt));
  primary.lastReadAt = getLatestDate(primary.lastReadAt, ...duplicates.map(conversation => conversation.lastReadAt));

  await primary.save();
  await Conversation.deleteMany({ _id: { $in: duplicates.map(conversation => conversation._id) } });
  return primary;
}

async function consolidateOpenDuplicates({ userId, leadId, channel }) {
  const conversations = await Conversation.find(openConversationFilter({ userId, leadId, channel }))
    .sort({ lastMessageAt: -1, updatedAt: -1 });

  return consolidateGroup(conversations);
}

async function consolidateOpenDuplicatesForUser(userId) {
  const groups = await Conversation.aggregate([
    { $match: { user: new mongoose.Types.ObjectId(userId), status: { $ne: 'closed' } } },
    { $group: { _id: { lead: '$lead', channel: '$channel' }, count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 }, '_id.lead': { $ne: null } } }
  ]);

  for (const group of groups) {
    const conversations = await Conversation.find({
      user: userId,
      lead: group._id.lead,
      channel: group._id.channel,
      status: { $ne: 'closed' }
    }).sort({ lastMessageAt: -1, updatedAt: -1 });

    await consolidateGroup(conversations);
  }
}

const touchOutboundConversation = (conversation, { message, channel, instanceId, ownerFields } = {}) => {
  conversation.messages = normalizeMessages(conversation.messages, channel || conversation.channel);

  if (instanceId && !conversation.instance) {
    conversation.instance = instanceId;
  }

  if (ownerFields) {
    conversation.conversationOwnerType = ownerFields.conversationOwnerType ?? conversation.conversationOwnerType;
    conversation.assignedTeamMember = ownerFields.assignedTeamMember ?? conversation.assignedTeamMember;
  }

  if (message) {
    conversation.messages.push({
      role: message.role || 'ai',
      content: message.content,
      channel
    });
  }

  conversation.lastMessageAt = new Date();
  conversation.lastOutboundMessageAt = new Date();
  conversation.sentCount = (conversation.sentCount || 0) + 1;
  return conversation;
};

module.exports = {
  findReusableConversation,
  consolidateOpenDuplicatesForUser,
  touchOutboundConversation
};
