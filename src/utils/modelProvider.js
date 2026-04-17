const MockModel = require('./mockManager');
const path = require('path');

const USE_MOCK = process.env.USE_MOCK_DATA === 'true';

const getModel = (modelName) => {
  if (USE_MOCK) {
    console.log(`[MockProvider] Using Mock for model: ${modelName}`);
    return MockModel.createConstructor(modelName);
  } else {
    // Dynamically require the real Mongoose model
    return require(`../models/${modelName}`);
  }
};

module.exports = { getModel, USE_MOCK };
