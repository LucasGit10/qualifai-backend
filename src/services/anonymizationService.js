const logger = require('../utils/logger');

class AnonymizationService {
  /**
   * Recebe um texto e remove/mascara dados sensíveis.
   * @param {string} text O texto original.
   * @returns {string} O texto anonimizado.
   */
  sanitizeText(text) {
    if (typeof text !== 'string' || !text) {
      return text;
    }

    let sanitizedText = text;

    try {
      // ===== NOVAS REGEX ADICIONADAS =====

      // Regex para CPF (formatos XXX.XXX.XXX-XX e XXXXXXXXXXX)
      const cpfRegex = /\b\d{3}[\.\s-]?\d{3}[\.\s-]?\d{3}[\.\s-]?\d{2}\b/g;
      
      // Regex para CNPJ (formatos XX.XXX.XXX/XXXX-XX e XXXXXXXXXXXXXX)
      const cnpjRegex = /\b\d{2}[\.\s-]?\d{3}[\.\s-]?\d{3}[\/\s-]?\d{4}[\s-]?\d{2}\b/g;

      // Regex para Email
      const emailRegex = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/g;
      
      // Regex para Telefone (formatos brasileiros variados)
      const phoneRegex = /\b\(?\d{2}\)?[\s-]?\d{4,5}[\s-]?\d{4}\b/g;

      // Regex para Cartão de Crédito (números de 13 a 16 dígitos, com ou sem espaços/hífens)
      const creditCardRegex = /\b(?:\d[ -]*?){13,16}\b/g;

      // Regex para CEP (formatos XXXXX-XXX e XXXXXXXX)
      const cepRegex = /\b\d{5}[\s-]?\d{3}\b/g;

      // Regex para RG (padrão genérico, pode variar por estado)
      const rgRegex = /\b\d{1,2}[\.\s-]?\d{3}[\.\s-]?\d{3}[\.\s-]?[\dX]\b/g;

      // ===== APLICAÇÃO DOS FILTROS =====

      // Primeiro, removemos dados mais específicos e longos como cartão, CNPJ e CPF
      // para evitar que a regex de telefone ou RG os capture por engano.
      sanitizedText = sanitizedText.replace(creditCardRegex, '[CARTAO_CREDITO OMITIDO]');
      sanitizedText = sanitizedText.replace(cnpjRegex, '[CNPJ OMITIDO]');
      sanitizedText = sanitizedText.replace(cpfRegex, '[CPF OMITIDO]');
      sanitizedText = sanitizedText.replace(rgRegex, '[RG OMITIDO]');
      
      // Depois, os dados restantes
      sanitizedText = sanitizedText.replace(emailRegex, '[EMAIL OMITIDO]');
      sanitizedText = sanitizedText.replace(phoneRegex, '[TELEFONE OMITIDO]');
      sanitizedText = sanitizedText.replace(cepRegex, '[CEP OMITIDO]');


    } catch (error) {
      logger.error('Erro ao anonimizar texto:', error);
      // Em caso de erro, retorna o texto original para não quebrar a aplicação
      return text;
    }
    
    return sanitizedText;
  }
}

// Exporta uma instância única do serviço (Singleton)
module.exports = new AnonymizationService();