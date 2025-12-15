const manager = (req, res, next) => {
    if (req.user && (req.user.role === 'manager' || req.user.role === 'admin')) {
      next();
    } else {
      res.status(403).json({ message: 'Acesso negado. Requer privilégios de gerente.' });
    }
  };
  
  module.exports = manager;
