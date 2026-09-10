const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const uploadRoot = path.join(process.cwd(), 'uploads');
const chunkRoot = path.join(uploadRoot, 'chunked');
const assembledPrefix = path.join(uploadRoot, 'chunked-complete-');

fs.mkdirSync(chunkRoot, { recursive: true });
fs.mkdirSync(uploadRoot, { recursive: true });

const readMetadata = (uploadId) => {
  if (!/^[a-f0-9-]{36}$/.test(uploadId)) throw new Error('Upload invalido.');
  const metadataPath = path.join(chunkRoot, uploadId, 'metadata.json');
  if (!fs.existsSync(metadataPath)) throw new Error('Upload nao encontrado.');
  return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
};

const assertOwner = (uploadId, userId) => {
  const metadata = readMetadata(uploadId);
  if (String(metadata.userId) !== String(userId)) throw new Error('Upload nao pertence ao usuario.');
  return metadata;
};

const startUpload = ({ userId, originalName, totalSize, totalChunks }) => {
  const uploadId = crypto.randomUUID();
  const directory = path.join(chunkRoot, uploadId);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'metadata.json'), JSON.stringify({
    userId: String(userId),
    originalName: path.basename(originalName),
    totalSize: Number(totalSize),
    totalChunks: Number(totalChunks),
    receivedChunks: []
  }));
  return uploadId;
};

const saveChunk = ({ uploadId, userId, chunkIndex, buffer }) => {
  const metadata = assertOwner(uploadId, userId);
  const index = Number(chunkIndex);
  if (!Number.isInteger(index) || index < 0 || index >= metadata.totalChunks) {
    throw new Error('Indice de parte invalido.');
  }

  const partPath = path.join(chunkRoot, uploadId, `${index}.part`);
  fs.writeFileSync(partPath, buffer);
  metadata.receivedChunks = [...new Set([...metadata.receivedChunks, index])].sort((a, b) => a - b);
  fs.writeFileSync(path.join(chunkRoot, uploadId, 'metadata.json'), JSON.stringify(metadata));
  return metadata;
};

const completeUpload = ({ uploadId, userId }) => {
  const metadata = assertOwner(uploadId, userId);
  if (metadata.receivedChunks.length !== metadata.totalChunks) {
    throw new Error('Ainda faltam partes do arquivo.');
  }

  const completedPath = `${assembledPrefix}${uploadId}${path.extname(metadata.originalName).toLowerCase()}`;
  const output = fs.openSync(completedPath, 'w');
  try {
    for (let index = 0; index < metadata.totalChunks; index += 1) {
      const partPath = path.join(chunkRoot, uploadId, `${index}.part`);
      fs.writeSync(output, fs.readFileSync(partPath));
    }
  } finally {
    fs.closeSync(output);
  }

  fs.rmSync(path.join(chunkRoot, uploadId), { recursive: true, force: true });
  fs.writeFileSync(`${assembledPrefix}${uploadId}.json`, JSON.stringify(metadata));
  return { filePath: completedPath, originalName: metadata.originalName };
};

const getCompletedUpload = ({ uploadId, userId }) => {
  const metadataPath = `${assembledPrefix}${uploadId}.json`;
  if (!fs.existsSync(metadataPath)) throw new Error('Upload finalizado nao encontrado.');
  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  if (String(metadata.userId) !== String(userId)) throw new Error('Upload nao pertence ao usuario.');
  const filePath = `${assembledPrefix}${uploadId}${path.extname(metadata.originalName).toLowerCase()}`;
  if (!fs.existsSync(filePath)) throw new Error('Arquivo finalizado nao encontrado.');
  return { filePath, originalName: metadata.originalName };
};

const cleanupCompletedUpload = (uploadId) => {
  if (!/^[a-f0-9-]{36}$/.test(String(uploadId || ''))) return;
  const extensionFiles = fs.readdirSync(uploadRoot)
    .filter((name) => name.startsWith(`chunked-complete-${uploadId}.`));
  extensionFiles.forEach((name) => fs.rmSync(path.join(uploadRoot, name), { force: true }));
};

module.exports = { startUpload, saveChunk, completeUpload, getCompletedUpload, cleanupCompletedUpload };
