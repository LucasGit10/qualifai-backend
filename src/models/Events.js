const mongoose = require('mongoose');

const eventSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
    trim: true
  },
  start: {
    type: Date,
    required: true
  },
  end: {
    type: Date,
    required: true
  },
  description: {
    type: String,
    trim: true
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  lead: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Lead',
    required: false 
  },
  crmIds: {
    type: Map,
    of: String, // e.g., { 'kommo': '12345', 'pipedrive': '67890' }
    default: {}
  },
  meetLink: {
    type: String,
    trim: true,
  }
}, {
  timestamps: true
});

eventSchema.index({ user: 1, start: 1, end: 1 });

module.exports = mongoose.model('Event', eventSchema);
