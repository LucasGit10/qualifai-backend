const logger = require('../utils/logger');
const User = require('../models/User');

class IntegrationUtils {
    cleanDomain(domain) {
        return domain ? domain.replace(/^https?:\/\//, '') : '';
    }
    
    _getApiConfig(platform, userSettings) {
        const config = userSettings?.integrations?.[platform];
        if (!config || !config.enabled) {
          throw new Error(`${platform} not configured or disabled.`);
        }
        return config;
    }

    cleanObject(obj) {
        Object.keys(obj).forEach(key => {
          if (obj[key] === null || obj[key] === undefined) delete obj[key];
        });
        return obj;
    }
    
    extractFirstName(fullName) {
        if (!fullName) return '';
        const parts = fullName.trim().split(' ');
        return parts[0] || '';
    }
    
    extractLastName(fullName) {
        if (!fullName) return '';
        const parts = fullName.trim().split(' ');
        return parts.length > 1 ? parts.slice(1).join(' ') : '';
    }

    createNoteFromConversation(conversationData) {
        let noteContent = `Conversation via QualifAI - Channel: ${conversationData.channel}\n\n`;
        conversationData.messages.forEach((message) => {
          const timestamp = new Date(message.timestamp).toLocaleString('pt-BR');
          const role = message.role === 'ai' ? '🤖 QualifAI' : '👤 Lead';
          noteContent += `${timestamp} - ${role}:\n${message.content}\n\n`;
        });
        return noteContent;
    }
}

module.exports = new IntegrationUtils();
