const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(
      process.env.MONGODB_URI, // || 'mongodb://localhost:27017/qualifai',
      {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 5000, 
      }
    );

    //console.log(`📊 MongoDB Connected: ${conn.connection.host}`);
    
    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });
    
    mongoose.connection.on('disconnected', () => {
      //console.log('MongoDB disconnected');
    });
    
    mongoose.connection.on('reconnected', () => {
      //console.log('MongoDB reconnected');
    });
    
  } catch (error) {
    console.error('Database connection error:', error);
    
    // In development, create in-memory fallback
    if (process.env.NODE_ENV === 'development') {
      //console.log('🔄 Falling back to in-memory storage for development');
      global.USE_MEMORY_DB = true;
    } else {
      process.exit(1);
    }
  }
};

module.exports = connectDB;