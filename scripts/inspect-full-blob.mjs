// Dump the complete structure (keys + value types, redacted) of the auth blob
// from a Trae storage.json so the switch writer can replicate the full shape.
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

const redact = (v, keep = 8) =>
  typeof v === 'string' && v.length > keep ? v.slice(0, keep) + `...(${v.length} chars)` : v;

// Recursively describe: keep full key paths + value types, redact long strings
function describe(value, prefix = '', out = []) {
  if (value === null || value === undefined) {
    out.push(`${prefix}: ${value}`);
    return out;
  }
  if (Array.isArray(value)) {
    out.push(`${prefix}: Array(${value.length})`);
    if (value.length > 0) describe(value[0], `${prefix}[0]`, out);
    return out;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix ? `${prefix}.${k}` : k;
      if (v !== null && typeof v === 'object') {
        describe(v, p, out);
      } else {
        out.push(`${p}: ${typeof v === 'string' ? JSON.stringify(redact(v)) : v}`);
      }
    }
    return out;
  }
  out.push(`${prefix}: ${typeof value === 'string' ? JSON.stringify(redact(value)) : value}`);
  return out;
}

const appData = process.env.APPDATA;
const target = process.argv[2] || path.join(appData, 'Trae CN', 'User', 'globalStorage', 'storage.json');
console.log(`Source: ${target}`);
const storage = JSON.parse(fs.readFileSync(target, 'utf-8'));
const enc = storage['iCubeAuthInfo://icube.cloudide'];
const blob = enc ? decryptTraeBlob(enc) : null;
if (!blob) {
  console.log('decryption failed');
  process.exit(1);
}
console.log(describe(blob).join('\n'));
