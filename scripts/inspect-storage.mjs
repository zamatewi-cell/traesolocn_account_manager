// Diagnostic: decrypt the iCubeAuthInfo blob in Trae storage.json files and
// print a redacted structural summary (no full secrets printed).
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const TRAE_MAGIC = Buffer.from([0x74, 0x63, 0x05, 0x10, 0x00, 0x00]);
const TRAE_SALT_LEN = 32;
const TRAE_HASH_LEN = 64;
const TRAE_AES_KEY_LEN = 16;
const TRAE_IV_LEN = 16;

const TRAE_KEY_A = Buffer.from([
  82, 9, 106, 213, 48, 54, 165, 56, 191, 64, 163, 158, 129, 243, 215, 251,
  124, 227, 57, 130, 155, 47, 255, 135, 52, 142, 67, 68, 196, 222, 233, 203,
  84, 123, 148, 50, 166, 194, 35, 61, 238, 76, 149, 11, 66, 250, 195, 78,
  8, 46, 161, 102, 40, 217, 36, 178, 118, 91, 162, 73, 109, 139, 209, 37
]);
const TRAE_KEY_B = Buffer.from([
  31, 221, 168, 51, 136, 7, 199, 49, 177, 18, 16, 89, 39, 128, 236, 95,
  96, 81, 127, 169, 25, 181, 74, 13, 45, 229, 122, 159, 147, 201, 156, 239,
  160, 224, 59, 77, 174, 42, 245, 176, 200, 235, 187, 60, 131, 83, 153, 97,
  23, 43, 4, 126, 186, 119, 214, 38, 225, 105, 20, 99, 85, 33, 12, 125
]);

function getHardcodedPassword() {
  const pw = Buffer.alloc(64);
  for (let i = 0; i < 64; i++) pw[i] = TRAE_KEY_A[i] ^ TRAE_KEY_B[i];
  return pw;
}
const sha512 = (d) => crypto.createHash('sha512').update(d).digest();

function deriveKey(salt) {
  const kdfOut = sha512(Buffer.concat([sha512(salt), getHardcodedPassword()]));
  return {
    key: kdfOut.subarray(0, TRAE_AES_KEY_LEN),
    iv: kdfOut.subarray(TRAE_AES_KEY_LEN, TRAE_AES_KEY_LEN + TRAE_IV_LEN),
  };
}

function decryptTraeBlob(encryptedBase64) {
  try {
    const blob = Buffer.from(encryptedBase64.trim(), 'base64');
    if (blob.length < TRAE_MAGIC.length + TRAE_SALT_LEN + TRAE_HASH_LEN + 1) return null;
    if (!blob.subarray(0, TRAE_MAGIC.length).equals(TRAE_MAGIC)) return null;
    const salt = blob.subarray(TRAE_MAGIC.length, TRAE_MAGIC.length + TRAE_SALT_LEN);
    const ciphertext = blob.subarray(TRAE_MAGIC.length + TRAE_SALT_LEN);
    const { key, iv } = deriveKey(salt);
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(true);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    if (plaintext.length < TRAE_HASH_LEN) return null;
    const data = plaintext.subarray(TRAE_HASH_LEN);
    return JSON.parse(data.toString('utf-8'));
  } catch {
    return null;
  }
}

function jwtPayload(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64').toString('utf-8'));
  } catch {
    return null;
  }
}

const redact = (s, keep = 6) =>
  typeof s === 'string' && s.length > keep ? s.slice(0, keep) + `...(${s.length} chars)` : s;

function describeBlob(label, blob) {
  console.log(`\n===== ${label} =====`);
  if (!blob) {
    console.log('  (no auth blob / decryption failed)');
    return;
  }
  const acc = blob.account || {};
  const jwt = jwtPayload(blob.token);
  const jwtExp = jwt?.exp ? new Date(jwt.exp * 1000).toISOString() : '(no exp claim)';
  const expiredAtStr = blob.expiredAt || '(missing)';
  const now = new Date();
  const tokenLooksExpired =
    (jwt?.exp && jwt.exp * 1000 < now.getTime()) ||
    (blob.expiredAt && new Date(blob.expiredAt).getTime() < now.getTime());

  console.log(`  userId:              ${blob.userId}`);
  console.log(`  host:                ${blob.host}`);
  console.log(`  token:               ${redact(blob.token)}`);
  console.log(`  token jwt exp:       ${jwtExp}`);
  console.log(`  expiredAt field:     ${expiredAtStr}`);
  console.log(`  token expired now:   ${tokenLooksExpired ? 'YES' : 'no'}`);
  console.log(`  refreshToken:        ${blob.refreshToken ? redact(blob.refreshToken, 8) : '(MISSING)'}`);
  console.log(`  refreshExpiredAt:    ${blob.refreshExpiredAt || '(missing)'}`);
  console.log(`  tokenReleaseAt:      ${blob.tokenReleaseAt || '(missing)'}`);
  console.log(`  userRegion:          ${JSON.stringify(blob.userRegion)}`);
  console.log(`  account.scope:       ${acc.scope}`);
  console.log(`  account.loginScope:  ${acc.loginScope}`);
  console.log(`  account.userTag:     ${acc.userTag}`);
  console.log(`  account.username:    ${acc.username}`);
  console.log(`  account.nickname:    ${acc.nickname}`);
  console.log(`  account.email:       ${acc.email}`);
  console.log(`  top-level keys:      ${Object.keys(blob).join(', ')}`);
  console.log(`  account keys:        ${Object.keys(acc).join(', ')}`);
}

const appData = process.env.APPDATA;
const installs = ['Trae CN', 'TRAE SOLO CN'];
for (const inst of installs) {
  for (const suffix of ['storage.json', 'storage.json.bak']) {
    const p = path.join(appData, inst, 'User', 'globalStorage', suffix);
    if (!fs.existsSync(p)) {
      console.log(`\n===== ${inst}\\${suffix}: FILE NOT FOUND =====`);
      continue;
    }
    try {
      const storage = JSON.parse(fs.readFileSync(p, 'utf-8'));
      const enc = storage['iCubeAuthInfo://icube.cloudide'];
      const mtime = fs.statSync(p).mtime.toISOString();
      console.log(`\n--- ${inst}\\${suffix} (mtime ${mtime}) ---`);
      console.log(`  storage keys count: ${Object.keys(storage).length}`);
      console.log(`  has serverData key: ${'iCubeServerData://icube.cloudide' in storage}`);
      describeBlob(`${inst} ${suffix}`, enc ? decryptTraeBlob(enc) : null);
    } catch (err) {
      console.log(`\n===== ${inst}\\${suffix}: PARSE ERROR ${err.message} =====`);
    }
  }
}
