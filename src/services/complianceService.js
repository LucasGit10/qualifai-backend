const { getModel } = require('../utils/modelProvider');

const ComplianceDocument = getModel('ComplianceDocument');

async function hasActiveComplianceDocument(userOrId) {
  const userId = userOrId?._id || userOrId?.id || userOrId;
  if (!userId) return false;

  if (userOrId?.compliance?.documentApprovedAt) return true;

  const activeDocument = await ComplianceDocument.exists({
    user: userId,
    status: 'active'
  });

  return Boolean(activeDocument);
}

module.exports = {
  hasActiveComplianceDocument
};
