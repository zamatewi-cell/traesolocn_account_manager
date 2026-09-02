const assert = require('node:assert/strict');
const test = require('node:test');
const {
  decryptExport,
  encryptExport,
  isEncryptedExportEnvelope,
} = require('../dist/main/utils/backup-crypto.js');

const fixture = {
  version: 2,
  exportedAt: '2026-09-02T00:00:00.000Z',
  accounts: [{ nickname: 'test', access_token: 'secret-access-token', refresh_token: 'secret-refresh-token' }],
};

test('encrypted account export round-trips without plaintext credentials', () => {
  const envelope = encryptExport(fixture, 'correct horse battery staple');
  assert.equal(isEncryptedExportEnvelope(envelope), true);
  const serialized = JSON.stringify(envelope);
  assert.equal(serialized.includes('secret-access-token'), false);
  assert.equal(serialized.includes('secret-refresh-token'), false);
  assert.deepEqual(decryptExport(envelope, 'correct horse battery staple'), fixture);
});

test('encrypted account export rejects the wrong password', () => {
  const envelope = encryptExport(fixture, 'correct horse battery staple');
  assert.throws(() => decryptExport(envelope, 'incorrect password'), /密码错误|文件已损坏/);
});

test('export requires a minimum-length password', () => {
  assert.throws(() => encryptExport(fixture, 'short'), /至少需要 8 个字符/);
});
