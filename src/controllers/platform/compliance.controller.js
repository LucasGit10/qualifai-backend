const fs = require('fs');
const path = require('path');
const { getModel } = require('../../utils/modelProvider');
const { handleControllerError } = require('../../utils/errorUtils');

const ComplianceDocument = getModel('ComplianceDocument');
const User = getModel('User');

const buildDocumentResponse = (document) => {
  if (!document) return null;
  return {
    _id: document._id,
    originalName: document.originalName,
    mimeType: document.mimeType,
    size: document.size,
    notes: document.notes,
    status: document.status,
    uploadedAt: document.uploadedAt,
    downloadUrl: '/compliance/document/download'
  };
};

class ComplianceController {
  async getStatus(req, res) {
    try {
      const document = await ComplianceDocument.findOne({ user: req.user.id, status: 'active' })
        .sort({ uploadedAt: -1 })
        .lean();

      res.json({
        required: true,
        completed: Boolean(document),
        document: buildDocumentResponse(document)
      });
    } catch (error) {
      return handleControllerError(res, error, 'ao buscar documento de compliance');
    }
  }

  async uploadDocument(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ message: 'Envie um arquivo PDF, imagem ou documento.' });
      }

      await ComplianceDocument.updateMany(
        { user: req.user.id, status: 'active' },
        { $set: { status: 'replaced' } }
      );

      const document = await ComplianceDocument.create({
        user: req.user.id,
        originalName: req.file.originalname,
        filename: req.file.filename,
        path: req.file.path,
        mimeType: req.file.mimetype,
        size: req.file.size,
        notes: req.body.notes
      });

      await User.findByIdAndUpdate(req.user.id, {
        'compliance.documentUploadedAt': document.uploadedAt,
        'compliance.documentApprovedAt': document.uploadedAt,
        'compliance.document': document._id
      });

      res.status(201).json({
        success: true,
        message: 'Documento anexado com sucesso.',
        document: buildDocumentResponse(document)
      });
    } catch (error) {
      return handleControllerError(res, error, 'ao salvar documento de compliance');
    }
  }

  async downloadDocument(req, res) {
    try {
      const document = await ComplianceDocument.findOne({ user: req.user.id, status: 'active' })
        .sort({ uploadedAt: -1 });

      if (!document || !fs.existsSync(document.path)) {
        return res.status(404).json({ message: 'Documento nao encontrado.' });
      }

      res.setHeader('Content-Type', document.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${path.basename(document.originalName)}"`);
      fs.createReadStream(document.path).pipe(res);
    } catch (error) {
      return handleControllerError(res, error, 'ao baixar documento de compliance');
    }
  }
}

module.exports = new ComplianceController();
