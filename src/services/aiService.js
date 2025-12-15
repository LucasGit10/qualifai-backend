const aiChatService = require('./ai/aiChatService');
const aiContentService = require('./ai/aiContentService');
const aiLogicService = require('./ai/aiLogicService');
const aiAudioService = require('./ai/aiAudioService');
const schedulingService = require('./scheduling/schedulingService');

module.exports = {
  generateLandingPageResponse: aiChatService.generateLandingPageResponse.bind(aiChatService),
  generateResponse: aiChatService.generateResponse.bind(aiChatService),
  
  generatePerformanceSummary: aiContentService.generatePerformanceSummary.bind(aiContentService),
  generateCampaignTemplate: aiContentService.generateCampaignTemplate.bind(aiContentService),

  classifyLead: aiLogicService.classifyLead.bind(aiLogicService),
  detectHumanHandoffRequest: aiLogicService.detectHumanHandoffRequest.bind(aiLogicService),

  textToSpeech: aiAudioService.textToSpeech.bind(aiAudioService),
  generateSpeechSample: aiAudioService.generateSpeechSample.bind(aiAudioService),
  speechToText: aiAudioService.speechToText.bind(aiAudioService),

  getAvailableSlots: schedulingService.getAvailableSlots.bind(schedulingService),
  generateSchedulingProposal: schedulingService.generateSchedulingProposal.bind(schedulingService),
  parseLeadSchedulingResponse: schedulingService.parseLeadSchedulingResponse.bind(schedulingService),
  createMeetingInCRMs: schedulingService.createMeetingInCRMs.bind(schedulingService),
};