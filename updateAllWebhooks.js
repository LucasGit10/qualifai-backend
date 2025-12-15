const axios = require('axios');
require('dotenv').config();

const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '429683C4C977415CAAFCCE10F7D57E11';
const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL;

async function updateAllWebhooks() {
  try {
    //console.log('🔍 Listing all instances...');
    
    // Listing all instances
    const response = await axios.get(`${EVOLUTION_API_URL}/instance/fetchInstances`, {
      headers: { 'apikey': EVOLUTION_API_KEY }
    });
    
    const instances = response.data || [];
    //console.log(`📋 Found ${instances.length} instances:`);
    
    // Show found instances
    instances.forEach((instance, index) => {
      //console.log(`${index + 1}. ${instance.instanceName} - Status: ${instance.connectionStatus}`);
    });
    
    //console.log('\n🔧 Updating webhooks...\n');
    
    for (const instance of instances) {
      const instanceName = instance.instanceName;
      const webhookUrl = `${WEBHOOK_BASE_URL}/api/webhooks/evolution/${instanceName}`;
      
      try {
        //console.log(`📡 Updating: ${instanceName}`);
        //console.log(`🎯 New URL: ${webhookUrl}`);
        
        const webhookResponse = await axios.post(`${EVOLUTION_API_URL}/webhook/set/${instanceName}`, {
          url: webhookUrl,
          events: [
            'APPLICATION_STARTUP',
            'QRCODE_UPDATED',
            'CONNECTION_UPDATE',
            'MESSAGES_UPSERT',
            'MESSAGES_UPDATE',
            'SEND_MESSAGE'
          ]
        }, {
          headers: { 'apikey': EVOLUTION_API_KEY }
        });
        
        //console.log(`✅ Success: ${instanceName}`);
        //console.log(`📋 Response:`, webhookResponse.data);
        //console.log('─'.repeat(50));
        
      } catch (webhookError) {
        console.error(`❌ Error for ${instanceName}:`, webhookError.response?.data || webhookError.message);
        //console.log('─'.repeat(50));
      }
    }
    
    //console.log('\n🎉 Process completed!');
    //console.log(`✅ All instances should now use: ${WEBHOOK_BASE_URL}/api/webhooks/evolution/[INSTANCE_NAME]`);
    
  } catch (error) {
    console.error('❌ Erro geral:', error.response?.data || error.message);
  }
}

updateAllWebhooks();