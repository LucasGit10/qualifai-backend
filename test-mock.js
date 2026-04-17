process.env.USE_MOCK_DATA = 'true';
const { getModel } = require('./src/utils/modelProvider');

async function test() {
  const Lead = getModel('Lead');
  console.log('Testing Lead.find()...');
  const leads = await Lead.find();
  console.log('Leads found:', leads.length);
  console.log('First lead name:', leads[0].name);

  console.log('\nTesting Lead.findOne()...');
  const lead = await Lead.findOne({ name: 'Maria Oliveira' });
  console.log('Lead found:', lead.name);

  console.log('\nTesting Lead.save()...');
  const newLead = new Lead({ name: 'Test Lead', email: 'test@example.com', user: 'user1_id' });
  await newLead.save();
  const allLeads = await Lead.find();
  console.log('New total leads:', allLeads.length);
}

test().catch(console.error);
