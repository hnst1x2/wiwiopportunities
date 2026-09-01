// Password hashing with Node's built-in scrypt (no native dependency).
// Stored format: "scrypt:<salt hex>:<hash hex>" so parameters can evolve later.
const crypto = require('crypto');

const SALT_BYTES = 16;
const KEY_LENGTH = 64;

function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, KEY_LENGTH).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  try {
    const expected = Buffer.from(parts[2], 'hex');
    const actual = crypto.scryptSync(String(password), parts[1], expected.length);
    return expected.length > 0 && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
