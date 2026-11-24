import crypto from 'crypto';
import path from 'path';

const SAFE_TOKEN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Fallback in-memory secret for ephemeral TURN credentials when TURN_SHARED_SECRET is unset
const EPHEMERAL_TURN_SECRET =
  process.env.TURN_SHARED_SECRET || crypto.randomBytes(32).toString('hex');

/**
 * Generates a cryptographically random 10-digit Session ID (1000000000 - 9999999999).
 */
export function generateSessionCode(): string {
  const num = crypto.randomInt(1_000_000_000, 9_999_999_999);
  return String(num);
}

/**
 * Generates a cryptographically random 10-digit persistent device identifier.
 */
export function generateDeviceCode(): string {
  const num = crypto.randomInt(100_000_000, 999_999_999);
  return String(num);
}

/**
 * Generates a single-use 6-character alphanumeric access code without ambiguous chars.
 */
export function generateAccessToken(length = 6): string {
  let token = '';
  for (let i = 0; i < length; i++) {
    const idx = crypto.randomInt(0, SAFE_TOKEN_CHARS.length);
    token += SAFE_TOKEN_CHARS[idx];
  }
  return token;
}

/**
 * Computes SHA-256 hash of a session access token for safe database storage.
 */
export function hashAccessToken(token: string): string {
  return crypto
    .createHash('sha256')
    .update(token.trim().toUpperCase())
    .digest('hex');
}

/**
 * Constant-time comparison between candidate access token and stored SHA-256 hash.
 */
export function verifyAccessToken(candidate: string, storedHash: string): boolean {
  const candidateHash = hashAccessToken(candidate);
  const bufA = Buffer.from(candidateHash, 'hex');
  const bufB = Buffer.from(storedHash, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates short-lived HMAC-SHA1 TURN credentials compatible with Coturn use-auth-secret.
 */
export function generateIceServers(userUid: string) {
  const iceServers: Array<{
    urls: string | string[];
    username?: string;
    credential?: string;
  }> = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  const turnUrl = process.env.TURN_SERVER_URL;
  if (turnUrl && turnUrl.trim().length > 0) {
    const ttlSeconds = 3600; // 1 hour short-lived credential
    const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
    const username = `${expiry}:${userUid.slice(0, 24)}`;
    const credential = crypto
      .createHmac('sha1', EPHEMERAL_TURN_SECRET)
      .update(username)
      .digest('base64');

    iceServers.push({
      urls: turnUrl.split(',').map((u) => u.trim()),
      username,
      credential,
    });
  }

  return iceServers;
}

const DANGEROUS_EXTENSIONS = new Set([
  '.exe',
  '.dll',
  '.bat',
  '.cmd',
  '.ps1',
  '.vbs',
  '.sh',
  '.msi',
  '.scr',
  '.com',
  '.pif',
  '.js',
  '.mjs',
  '.html',
  '.htm',
  '.svg',
]);

// EICAR standard antivirus test signature & PE/ELF executable headers
const EICAR_SIGNATURE = 'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*';

export function scanUploadedFileBuffer(
  originalName: string,
  buffer: Buffer,
  allowedExtensions: string[]
): { safe: boolean; reason?: string; sha256: string } {
  const ext = path.extname(originalName).toLowerCase();
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');

  if (!ext || DANGEROUS_EXTENSIONS.has(ext)) {
    return {
      safe: false,
      reason: `Blocked file extension (${ext || 'none'}) due to corporate security policy.`,
      sha256,
    };
  }

  const normalizedAllowed = allowedExtensions.map((e) => e.toLowerCase());
  if (!normalizedAllowed.includes(ext)) {
    return {
      safe: false,
      reason: `File extension ${ext} is not on the approved Vetiva transfer allowlist.`,
      sha256,
    };
  }

  // Check PE (MZ) and ELF binary magic headers
  if (buffer.length >= 2 && buffer[0] === 0x4d && buffer[1] === 0x5a) {
    return {
      safe: false,
      reason: 'Executable PE binary header detected and quarantined.',
      sha256,
    };
  }
  if (
    buffer.length >= 4 &&
    buffer[0] === 0x7f &&
    buffer[1] === 0x45 &&
    buffer[2] === 0x4c &&
    buffer[3] === 0x46
  ) {
    return {
      safe: false,
      reason: 'Executable ELF binary header detected and quarantined.',
      sha256,
    };
  }

  // Check EICAR test signature
  if (buffer.toString('utf8', 0, Math.min(buffer.length, 4096)).includes(EICAR_SIGNATURE)) {
    return {
      safe: false,
      reason: 'Malware test signature detected by Vetiva file scanner.',
      sha256,
    };
  }

  return { safe: true, sha256 };
}

export function sanitizeFilename(name: string): string {
  const base = path.basename(name).replace(/[^a-zA-Z0-9._ -]/g, '_');
  return base.slice(0, 120) || 'transfer_file';
}
