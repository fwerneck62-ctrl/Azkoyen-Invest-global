import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

const EPHEMERAL_SESSION_SECRET = crypto.randomBytes(32);

export function validateProductionSecurityEnv() {
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 16) {
      console.warn(
        '[SECURITY WARNING] SESSION_SECRET is not set (min 16 chars). Active sessions will reset across server restarts.'
      );
    }
    if (!process.env.VAULT_ENCRYPTION_KEY || process.env.VAULT_ENCRYPTION_KEY.length < 16) {
      console.warn(
        '[SECURITY WARNING] VAULT_ENCRYPTION_KEY is not set. Set a dedicated 32+ byte secret before storing production exchange keys.'
      );
    }
  }
}

function getSessionSecret(): Buffer {
  const envSecret = process.env.SESSION_SECRET;
  if (envSecret && envSecret.length >= 16) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  return EPHEMERAL_SESSION_SECRET;
}

function getVaultKey(): Buffer {
  const envVault = process.env.VAULT_ENCRYPTION_KEY;
  if (envVault && envVault.length >= 16) {
    return crypto.createHash('sha256').update(envVault).digest();
  }
  return crypto.createHash('sha256').update(getSessionSecret()).digest();
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 2) return false;
  const [salt, expectedHex] = parts;
  const derived = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

export interface SessionTokenPayload {
  sid: string;
  uid: string;
  role: 'investor' | 'trader' | 'admin';
  exp: number;
}

export function signSessionToken(payload: SessionTokenPayload): string {
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');
  return `${body}.${sig}`;
}

export function verifySessionToken(token: string): SessionTokenPayload | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(body)
    .digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as SessionTokenPayload;
    if (!decoded.uid || !decoded.sid || !decoded.exp || decoded.exp < Date.now()) {
      return null;
    }
    return decoded;
  } catch {
    return null;
  }
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Base32 RFC 4648 for TOTP MFA secrets
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function generateTotpSecret(bytes = 20): string {
  const buf = crypto.randomBytes(bytes);
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return out;
}

function decodeBase32(secret: string): Buffer {
  const clean = secret.toUpperCase().replace(/[^A-Z2-7]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpCode(secret: string, stepOffset = 0): string {
  const key = decodeBase32(secret);
  const counter = Math.floor(Date.now() / 1000 / 30) + stepOffset;
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', key).update(msg).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, '0');
}

export function verifyTotpCode(secret: string, code: string): boolean {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  for (const offset of [-1, 0, 1]) {
    const expected = generateTotpCode(secret, offset);
    if (crypto.timingSafeEqual(Buffer.from(normalized), Buffer.from(expected))) {
      return true;
    }
  }
  return false;
}

export function buildOtpAuthUri(email: string, secret: string): string {
  const label = encodeURIComponent(`AZKOYEN INVEST:${email}`);
  const issuer = encodeURIComponent('AZKOYEN INVEST');
  return `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
}

export function encryptVaultSecret(plaintext: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getVaultKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptVaultSecret(payload: string): string {
  const parts = payload.split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted payload');
  const [ivHex, tagHex, dataHex] = parts;
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getVaultKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function createRateLimiter(maxRequests: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${ip}:${req.path}`;
    const now = Date.now();
    const windowStart = now - windowMs;
    const recent = (hits.get(key) || []).filter((ts) => ts > windowStart);
    if (recent.length >= maxRequests) {
      return res.status(429).json({
        error: 'Limite de requisições excedido. Aguarde alguns instantes.',
      });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      hits.clear();
    }
    next();
  };
}
