const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error(err.stack);

  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map(e => e.message);
    return res.status(400).json({ message: 'Erro de validação', errors });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ message: 'ID inválido' });
  }

  if (err.code === 11000) {
    return res.status(400).json({ message: 'Recurso já existe' });
  }

  res.status(500).json({ message: 'Erro interno do servidor' });
};

module.exports = errorHandler;