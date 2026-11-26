import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AppSettingsRecord,
  AuditLogRecord,
  DashboardPayload,
  DeviceRecord,
  FileTransferRecord,
  RemoteSession,
  SessionMessage,
  SessionParticipantSummary,
  SessionPermissions,
  UserInviteRecord,
  UserProfile,
  UserRole,
} from '../types/remoteDesk.ts';

export const BOOTSTRAP_ADMIN_EMAIL = 'gideonline18@gmail.com';

export const DEFAULT_APP_SETTINGS: AppSettingsRecord = {
  settingKey: 'default',
  sessionExpiryMinutes: 60,
  maxFailedAttempts: 5,
  maxFileSizeMb: 25,
  requireExplicitControlConsent: true,
  allowSessionRecording: true,
  enforceVetivaDomainOnly: false,
  allowedFileExtensions: [
    '.pdf',
    '.png',
    '.jpg',
    '.jpeg',
    '.txt',
    '.csv',
    '.log',
    '.zip',
    '.docx',
    '.xlsx',
  ],
  updatedAt: new Date().toISOString(),
};

const DB_PATH = path.resolve(
  process.cwd(),
  process.env.SQLITE_DB_PATH || path.join('data', 'remote-desk.db')
);
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    uid TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'Vetiva Operations',
    role_slug TEXT NOT NULL DEFAULT 'employee',
    is_active INTEGER NOT NULL DEFAULT 1,
    is_online INTEGER NOT NULL DEFAULT 0,
    last_seen_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS invites (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL,
    display_name TEXT NOT NULL,
    department TEXT NOT NULL DEFAULT 'Vetiva Operations',
    role_slug TEXT NOT NULL DEFAULT 'employee',
    claimed INTEGER NOT NULL DEFAULT 0,
    created_by_uid TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    device_code TEXT NOT NULL UNIQUE,
    owner_uid TEXT NOT NULL,
    hostname TEXT NOT NULL,
    os_platform TEXT NOT NULL DEFAULT 'Web Browser',
    agent_version TEXT NOT NULL DEFAULT 'web-client-1.0',
    native_agent_linked INTEGER NOT NULL DEFAULT 0,
    last_active_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (owner_uid) REFERENCES users(uid) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS app_settings (
    setting_key TEXT PRIMARY KEY,
    session_expiry_minutes INTEGER NOT NULL,
    max_failed_attempts INTEGER NOT NULL,
    max_file_size_mb INTEGER NOT NULL,
    require_explicit_control_consent INTEGER NOT NULL,
    allow_session_recording INTEGER NOT NULL,
    enforce_vetiva_domain_only INTEGER NOT NULL,
    allowed_file_extensions TEXT NOT NULL,
    updated_by_uid TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    session_code TEXT NOT NULL UNIQUE,
    access_token_hash TEXT NOT NULL,
    host_uid TEXT NOT NULL,
    technician_uid TEXT,
    device_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'waiting',
    issue_summary TEXT NOT NULL DEFAULT 'IT Desk Screen Share',
    failed_join_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TEXT,
    connection_quality TEXT NOT NULL DEFAULT 'good',
    latency_ms INTEGER NOT NULL DEFAULT 0,
    permissions_json TEXT NOT NULL,
    started_at TEXT,
    ended_at TEXT,
    expires_at TEXT NOT NULL,
    ended_by_uid TEXT,
    end_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (host_uid) REFERENCES users(uid) ON DELETE CASCADE,
    FOREIGN KEY (technician_uid) REFERENCES users(uid) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS session_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    host_uid TEXT NOT NULL,
    technician_uid TEXT,
    sender_uid TEXT,
    sender_name TEXT NOT NULL,
    message_type TEXT NOT NULL DEFAULT 'text',
    body TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS file_transfers (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    host_uid TEXT NOT NULL,
    technician_uid TEXT,
    uploader_uid TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    sha256_hash TEXT NOT NULL,
    scan_status TEXT NOT NULL DEFAULT 'clean',
    download_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    actor_uid TEXT NOT NULL,
    actor_email TEXT,
    session_id TEXT,
    action TEXT NOT NULL,
    severity TEXT NOT NULL DEFAULT 'info',
    metadata_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_sessions_host ON sessions(host_uid);
  CREATE INDEX IF NOT EXISTS idx_sessions_tech ON sessions(technician_uid);
  CREATE INDEX IF NOT EXISTS idx_sessions_created ON sessions(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_messages_session ON session_messages(session_id, created_at ASC);
  CREATE INDEX IF NOT EXISTS idx_files_session ON file_transfers(session_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
`);

function nowIso(): string {
  return new Date().toISOString();
}

function ensureDefaultSettings() {
  const existing = db
    .prepare('SELECT setting_key FROM app_settings WHERE setting_key = ?')
    .get('default');
  if (!existing) {
    db.prepare(
      `INSERT INTO app_settings (
        setting_key, session_expiry_minutes, max_failed_attempts, max_file_size_mb,
        require_explicit_control_consent, allow_session_recording, enforce_vetiva_domain_only,
        allowed_file_extensions, updated_by_uid, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'default',
      DEFAULT_APP_SETTINGS.sessionExpiryMinutes,
      DEFAULT_APP_SETTINGS.maxFailedAttempts,
      DEFAULT_APP_SETTINGS.maxFileSizeMb,
      DEFAULT_APP_SETTINGS.requireExplicitControlConsent ? 1 : 0,
      DEFAULT_APP_SETTINGS.allowSessionRecording ? 1 : 0,
      DEFAULT_APP_SETTINGS.enforceVetivaDomainOnly ? 1 : 0,
      JSON.stringify(DEFAULT_APP_SETTINGS.allowedFileExtensions),
      null,
      nowIso()
    );
  }
}
ensureDefaultSettings();

function mapUserRow(row: Record<string, unknown>): UserProfile {
  return {
    id: String(row.uid),
    uid: String(row.uid),
    email: String(row.email),
    displayName: String(row.display_name),
    department: String(row.department),
    roleSlug: (row.role_slug as UserRole) || 'employee',
    isActive: Number(row.is_active) === 1,
    isOnline: Number(row.is_online) === 1,
    lastSeenAt: typeof row.last_seen_at === 'string' ? row.last_seen_at : undefined,
  };
}

function toParticipantSummary(row: Record<string, unknown> | undefined): SessionParticipantSummary | null {
  if (!row) return null;
  return {
    uid: String(row.uid),
    displayName: String(row.display_name),
    email: String(row.email),
    department: String(row.department),
    roleSlug: (row.role_slug as UserRole) || 'employee',
    isOnline: Number(row.is_online) === 1,
  };
}

function mapMessageRow(row: Record<string, unknown>): SessionMessage {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    hostUid: String(row.host_uid),
    technicianUid: typeof row.technician_uid === 'string' ? row.technician_uid : null,
    senderUid: typeof row.sender_uid === 'string' ? row.sender_uid : null,
    senderName: String(row.sender_name),
    messageType: row.message_type === 'system' ? 'system' : 'text',
    body: String(row.body),
    createdAt: String(row.created_at),
  };
}

function mapFileRow(row: Record<string, unknown>): FileTransferRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    hostUid: String(row.host_uid),
    technicianUid: typeof row.technician_uid === 'string' ? row.technician_uid : null,
    uploaderUid: String(row.uploader_uid),
    originalName: String(row.original_name),
    storedName: String(row.stored_name),
    mimeType: String(row.mime_type),
    sizeBytes: Number(row.size_bytes),
    sha256Hash: String(row.sha256_hash),
    scanStatus: String(row.scan_status),
    downloadCount: Number(row.download_count),
    createdAt: String(row.created_at),
  };
}

function mapSessionRow(
  row: Record<string, unknown>,
  includeChildren = true
): RemoteSession {
  const hostRow = db
    .prepare('SELECT uid, display_name, email, department, role_slug, is_online FROM users WHERE uid = ?')
    .get(String(row.host_uid)) as Record<string, unknown> | undefined;
  const techRow =
    typeof row.technician_uid === 'string'
      ? (db
          .prepare('SELECT uid, display_name, email, department, role_slug, is_online FROM users WHERE uid = ?')
          .get(row.technician_uid) as Record<string, unknown> | undefined)
      : undefined;

  let perms: SessionPermissions | null = null;
  try {
    perms = JSON.parse(String(row.permissions_json)) as SessionPermissions;
  } catch {
    perms = null;
  }

  const messages = includeChildren
    ? (db
        .prepare('SELECT * FROM session_messages WHERE session_id = ? ORDER BY created_at ASC')
        .all(String(row.id)) as Array<Record<string, unknown>>).map(mapMessageRow)
    : [];

  const files = includeChildren
    ? (db
        .prepare('SELECT * FROM file_transfers WHERE session_id = ? ORDER BY created_at DESC')
        .all(String(row.id)) as Array<Record<string, unknown>>).map(mapFileRow)
    : [];

  return {
    id: String(row.id),
    sessionCode: String(row.session_code),
    hostUid: String(row.host_uid),
    technicianUid: typeof row.technician_uid === 'string' ? row.technician_uid : null,
    deviceId: String(row.device_id),
    status: row.status as RemoteSession['status'],
    issueSummary: String(row.issue_summary),
    connectionQuality: String(row.connection_quality),
    latencyMs: Number(row.latency_ms || 0),
    startedAt: typeof row.started_at === 'string' ? row.started_at : null,
    endedAt: typeof row.ended_at === 'string' ? row.ended_at : null,
    expiresAt: String(row.expires_at),
    endReason: typeof row.end_reason === 'string' ? row.end_reason : null,
    createdAt: String(row.created_at),
    host: toParticipantSummary(hostRow),
    technician: toParticipantSummary(techRow),
    permissions: perms,
    messages,
    files,
  };
}

export function getUserByUid(uid: string): UserProfile | null {
  const row = db.prepare('SELECT * FROM users WHERE uid = ?').get(uid) as
    | Record<string, unknown>
    | undefined;
  return row ? mapUserRow(row) : null;
}

export function getAppSettings(): AppSettingsRecord {
  ensureDefaultSettings();
  const row = db
    .prepare('SELECT * FROM app_settings WHERE setting_key = ?')
    .get('default') as Record<string, unknown>;
  let exts = DEFAULT_APP_SETTINGS.allowedFileExtensions;
  try {
    const parsed = JSON.parse(String(row.allowed_file_extensions));
    if (Array.isArray(parsed) && parsed.length > 0) {
      exts = parsed.map(String);
    }
  } catch {
    // Keep defaults
  }
  return {
    settingKey: 'default',
    sessionExpiryMinutes: Number(row.session_expiry_minutes),
    maxFailedAttempts: Number(row.max_failed_attempts),
    maxFileSizeMb: Number(row.max_file_size_mb),
    requireExplicitControlConsent: Number(row.require_explicit_control_consent) === 1,
    allowSessionRecording: Number(row.allow_session_recording) === 1,
    enforceVetivaDomainOnly: Number(row.enforce_vetiva_domain_only) === 1,
    allowedFileExtensions: exts,
    updatedAt: String(row.updated_at),
  };
}

export function updateAppSettings(
  updates: {
    sessionExpiryMinutes: number;
    maxFailedAttempts: number;
    maxFileSizeMb: number;
    requireExplicitControlConsent: boolean;
    allowSessionRecording: boolean;
    enforceVetivaDomainOnly: boolean;
    allowedFileExtensions: string[];
  },
  actor: UserProfile
): AppSettingsRecord {
  const cleanExts = updates.allowedFileExtensions
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.startsWith('.') && e.length >= 2 && e.length <= 12)
    .slice(0, 25);
  const finalExts =
    cleanExts.length > 0 ? cleanExts : DEFAULT_APP_SETTINGS.allowedFileExtensions;

  const sessionExpiryMinutes = Math.min(480, Math.max(5, Math.round(updates.sessionExpiryMinutes)));
  const maxFailedAttempts = Math.min(20, Math.max(2, Math.round(updates.maxFailedAttempts)));
  const maxFileSizeMb = Math.min(50, Math.max(1, Math.round(updates.maxFileSizeMb)));
  const updatedAt = nowIso();

  db.prepare(
    `UPDATE app_settings
     SET session_expiry_minutes = ?, max_failed_attempts = ?, max_file_size_mb = ?,
         require_explicit_control_consent = ?, allow_session_recording = ?,
         enforce_vetiva_domain_only = ?, allowed_file_extensions = ?,
         updated_by_uid = ?, updated_at = ?
     WHERE setting_key = ?`
  ).run(
    sessionExpiryMinutes,
    maxFailedAttempts,
    maxFileSizeMb,
    updates.requireExplicitControlConsent ? 1 : 0,
    updates.allowSessionRecording ? 1 : 0,
    updates.enforceVetivaDomainOnly ? 1 : 0,
    JSON.stringify(finalExts),
    actor.uid,
    updatedAt,
    'default'
  );

  recordAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'admin.settings_updated',
    severity: 'warning',
    metadata: { sessionExpiryMinutes, maxFailedAttempts, maxFileSizeMb },
  });

  return getAppSettings();
}

export function recordAuditLog(params: {
  actorUid: string;
  actorEmail: string | null;
  sessionId?: string | null;
  action: string;
  severity?: 'info' | 'warning' | 'critical';
  metadata?: Record<string, unknown>;
}): AuditLogRecord {
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const severity = params.severity ?? 'info';
  const metadata = params.metadata ?? {};
  db.prepare(
    `INSERT INTO audit_logs (id, actor_uid, actor_email, session_id, action, severity, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.actorUid,
    params.actorEmail ? params.actorEmail.slice(0, 200) : null,
    params.sessionId ?? null,
    params.action.slice(0, 100),
    severity,
    JSON.stringify(metadata),
    createdAt
  );
  return {
    id,
    actorUid: params.actorUid,
    actorEmail: params.actorEmail,
    sessionId: params.sessionId ?? null,
    action: params.action,
    severity,
    metadata,
    createdAt,
  };
}

export function syncAuthenticatedUserAndDevice(params: {
  uid: string;
  email: string;
  displayName: string;
  userAgent: string;
}): { user: UserProfile; device: DeviceRecord } {
  const email = params.email.trim().toLowerCase();
  const now = nowIso();
  const fallbackName = (
    params.displayName ||
    email.split('@')[0].replace(/[._]/g, ' ') ||
    'Vetiva User'
  )
    .trim()
    .slice(0, 100);

  const settings = getAppSettings();
  const existingRow = db.prepare('SELECT * FROM users WHERE uid = ?').get(params.uid) as
    | Record<string, unknown>
    | undefined;

  let user: UserProfile;
  if (existingRow) {
    if (Number(existingRow.is_active) !== 1) {
      throw new Error('Account has been deactivated by an administrator.');
    }
    const nextRole: UserRole =
      email === BOOTSTRAP_ADMIN_EMAIL
        ? 'admin'
        : ((existingRow.role_slug as UserRole) || 'employee');
    const resolvedName = String(existingRow.display_name || fallbackName).slice(0, 100);

    db.prepare(
      `UPDATE users
       SET email = ?, display_name = ?, role_slug = ?, is_online = 1, last_seen_at = ?, updated_at = ?
       WHERE uid = ?`
    ).run(email, resolvedName, nextRole, now, now, params.uid);

    user = getUserByUid(params.uid)!;
  } else {
    const inviteRow = db
      .prepare('SELECT * FROM invites WHERE lower(email) = ? AND claimed = 0 LIMIT 1')
      .get(email) as Record<string, unknown> | undefined;

    if (
      settings.enforceVetivaDomainOnly &&
      email !== BOOTSTRAP_ADMIN_EMAIL &&
      !inviteRow &&
      !email.endsWith('@vetiva.com')
    ) {
      throw new Error(
        'Access restricted to @vetiva.com corporate accounts or pre-approved invites.'
      );
    }

    const assignedRole: UserRole =
      email === BOOTSTRAP_ADMIN_EMAIL
        ? 'admin'
        : ((inviteRow?.role_slug as UserRole) || 'employee');
    const assignedDept = inviteRow
      ? String(inviteRow.department).slice(0, 100)
      : assignedRole === 'admin'
        ? 'IT Infrastructure & Security'
        : 'Vetiva Operations';
    const resolvedName = inviteRow
      ? String(inviteRow.display_name).slice(0, 100)
      : fallbackName;

    db.prepare(
      `INSERT INTO users (uid, email, display_name, department, role_slug, is_active, is_online, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?, ?)`
    ).run(params.uid, email, resolvedName, assignedDept, assignedRole, now, now, now);

    if (inviteRow) {
      db.prepare('UPDATE invites SET claimed = 1, updated_at = ? WHERE id = ?').run(
        now,
        String(inviteRow.id)
      );
    }

    user = getUserByUid(params.uid)!;
  }

  const ua = params.userAgent || '';
  const platform = ua.includes('Win')
    ? 'Windows Workstation'
    : ua.includes('Mac')
      ? 'macOS Workstation'
      : ua.includes('Linux')
        ? 'Linux Workstation'
        : 'Web Browser';

  const deviceId = `${params.uid}_primary`;
  const existingDevice = db
    .prepare('SELECT * FROM devices WHERE id = ?')
    .get(deviceId) as Record<string, unknown> | undefined;

  let device: DeviceRecord;
  if (existingDevice) {
    db.prepare(
      `UPDATE devices SET os_platform = ?, last_active_at = ?, updated_at = ? WHERE id = ?`
    ).run(platform, now, now, deviceId);
    device = {
      id: deviceId,
      deviceCode: String(existingDevice.device_code),
      hostname: String(existingDevice.hostname),
      osPlatform: platform,
      agentVersion: String(existingDevice.agent_version || 'web-client-1.0'),
      nativeAgentLinked: Number(existingDevice.native_agent_linked) === 1,
    };
  } else {
    const prefix =
      user.displayName
        .replace(/[^a-zA-Z0-9]/g, '')
        .toUpperCase()
        .slice(0, 8) || 'VETIVA';
    const deviceCode = String(crypto.randomInt(100_000_000, 999_999_999));
    const hostname = `${prefix}-WS01`;

    db.prepare(
      `INSERT INTO devices (id, device_code, owner_uid, hostname, os_platform, agent_version, native_agent_linked, last_active_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'web-client-1.0', 0, ?, ?, ?)`
    ).run(deviceId, deviceCode, params.uid, hostname, platform, now, now, now);

    device = {
      id: deviceId,
      deviceCode,
      hostname,
      osPlatform: platform,
      agentVersion: 'web-client-1.0',
      nativeAgentLinked: false,
    };
  }

  recordAuditLog({
    actorUid: user.uid,
    actorEmail: user.email,
    action: 'auth.login',
    severity: 'info',
    metadata: { role: user.roleSlug },
  });

  return { user, device };
}

export function markUserOffline(uid: string) {
  const user = getUserByUid(uid);
  if (!user) return;
  const now = nowIso();
  db.prepare(
    'UPDATE users SET is_online = 0, last_seen_at = ?, updated_at = ? WHERE uid = ?'
  ).run(now, now, uid);
  recordAuditLog({
    actorUid: user.uid,
    actorEmail: user.email,
    action: 'auth.logout',
    severity: 'info',
  });
}

export function createSessionRecord(params: {
  host: UserProfile;
  deviceId: string;
  sessionCode: string;
  tokenHash: string;
  issueSummary: string;
}): RemoteSession {
  const ownedDevice = db
    .prepare('SELECT id FROM devices WHERE id = ? AND owner_uid = ?')
    .get(params.deviceId, params.host.uid);
  if (!ownedDevice) {
    throw new Error('Workstation device is not registered to this user.');
  }

  const settings = getAppSettings();
  const now = nowIso();
  const expiresAt = new Date(
    Date.now() + settings.sessionExpiryMinutes * 60 * 1000
  ).toISOString();
  const cleanSummary =
    params.issueSummary.trim().slice(0, 160) || 'IT Desk Screen Share';

  // Close prior waiting sessions hosted by this user
  const priorRows = db
    .prepare("SELECT id, permissions_json FROM sessions WHERE host_uid = ? AND status = 'waiting'")
    .all(params.host.uid) as Array<Record<string, unknown>>;

  for (const r of priorRows) {
    let perms: SessionPermissions;
    try {
      perms = JSON.parse(String(r.permissions_json)) as SessionPermissions;
    } catch {
      perms = {
        profileName: 'View Only',
        canViewScreen: true,
        canControlInput: false,
        canShareClipboard: false,
        canTransferFiles: false,
        canRecordSession: false,
        unattendedAccess: false,
        emergencyStoppedAt: null,
        updatedByUid: params.host.uid,
        updatedAt: now,
      };
    }
    perms = {
      ...perms,
      canControlInput: false,
      canShareClipboard: false,
      canTransferFiles: false,
      canRecordSession: false,
      unattendedAccess: false,
      updatedByUid: params.host.uid,
      updatedAt: now,
    };
    db.prepare(
      `UPDATE sessions
       SET status = 'ended', ended_at = ?, ended_by_uid = ?, end_reason = 'Replaced by new session',
           permissions_json = ?, updated_at = ?
       WHERE id = ?`
    ).run(now, params.host.uid, JSON.stringify(perms), now, String(r.id));
  }

  const initialPerms: SessionPermissions = {
    profileName: 'View Only',
    canViewScreen: true,
    canControlInput: false,
    canShareClipboard: false,
    canTransferFiles: false,
    canRecordSession: false,
    unattendedAccess: false,
    emergencyStoppedAt: null,
    updatedByUid: params.host.uid,
    updatedAt: now,
  };

  db.prepare(
    `INSERT INTO sessions (
      id, session_code, access_token_hash, host_uid, technician_uid, device_id,
      status, issue_summary, failed_join_attempts, locked_until, connection_quality,
      latency_ms, permissions_json, started_at, ended_at, expires_at, ended_by_uid,
      end_reason, created_at, updated_at
    ) VALUES (?, ?, ?, ?, NULL, ?, 'waiting', ?, 0, NULL, 'good', 0, ?, NULL, NULL, ?, NULL, NULL, ?, ?)`
  ).run(
    params.sessionCode,
    params.sessionCode,
    params.tokenHash,
    params.host.uid,
    params.deviceId,
    cleanSummary,
    JSON.stringify(initialPerms),
    expiresAt,
    now,
    now
  );

  db.prepare(
    `INSERT INTO session_messages (
      id, session_id, host_uid, technician_uid, sender_uid, sender_name, message_type, body, created_at
    ) VALUES (?, ?, ?, NULL, NULL, 'Vetiva Security', 'system', ?, ?)`
  ).run(
    crypto.randomUUID(),
    params.sessionCode,
    params.host.uid,
    `Session ${params.sessionCode} initialized. Waiting for authorized IT Support connection.`,
    now
  );

  recordAuditLog({
    actorUid: params.host.uid,
    actorEmail: params.host.email,
    sessionId: params.sessionCode,
    action: 'session.created',
    severity: 'info',
    metadata: { sessionCode: params.sessionCode },
  });

  return getSessionById(params.sessionCode)!;
}

export function getSessionRow(sessionId: string): Record<string, unknown> | undefined {
  return db.prepare('SELECT * FROM sessions WHERE id = ? OR session_code = ?').get(
    sessionId,
    sessionId
  ) as Record<string, unknown> | undefined;
}

export function getSessionById(sessionId: string): RemoteSession | null {
  const row = getSessionRow(sessionId);
  return row ? mapSessionRow(row, true) : null;
}

export function canUserAccessSession(
  session: { hostUid: string; technicianUid: string | null },
  user: UserProfile
): boolean {
  return (
    user.roleSlug === 'admin' ||
    session.hostUid === user.uid ||
    session.technicianUid === user.uid
  );
}

export function recordSessionJoinFailure(
  sessionCode: string,
  maxAttempts: number
): { locked: boolean; attemptsRemaining: number } {
  const row = getSessionRow(sessionCode);
  if (!row) {
    return { locked: false, attemptsRemaining: maxAttempts };
  }
  const nextAttempts = Number(row.failed_join_attempts || 0) + 1;
  const shouldLock = nextAttempts >= maxAttempts;
  const lockedUntil = shouldLock
    ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
    : null;
  db.prepare(
    'UPDATE sessions SET failed_join_attempts = ?, locked_until = ?, updated_at = ? WHERE id = ?'
  ).run(nextAttempts, lockedUntil, nowIso(), String(row.id));

  return {
    locked: shouldLock,
    attemptsRemaining: Math.max(0, maxAttempts - nextAttempts),
  };
}

export function joinSessionInDb(params: {
  sessionId: string;
  technician: UserProfile;
}): RemoteSession {
  const row = getSessionRow(params.sessionId);
  if (!row) throw new Error('Session not found.');
  const now = nowIso();
  const nextStatus = row.status === 'active' ? 'active' : 'pending_approval';

  db.prepare(
    `UPDATE sessions
     SET technician_uid = ?, status = ?, failed_join_attempts = 0, locked_until = NULL, updated_at = ?
     WHERE id = ?`
  ).run(params.technician.uid, nextStatus, now, String(row.id));

  db.prepare(
    `INSERT INTO session_messages (
      id, session_id, host_uid, technician_uid, sender_uid, sender_name, message_type, body, created_at
    ) VALUES (?, ?, ?, ?, ?, 'Vetiva Security', 'system', ?, ?)`
  ).run(
    crypto.randomUUID(),
    String(row.id),
    String(row.host_uid),
    params.technician.uid,
    params.technician.uid,
    `Session request received from ${params.technician.displayName} (${params.technician.email}).`,
    now
  );

  recordAuditLog({
    actorUid: params.technician.uid,
    actorEmail: params.technician.email,
    sessionId: String(row.id),
    action: 'session.join_requested',
    severity: 'info',
  });

  return getSessionById(String(row.id))!;
}

export function expireSessionInDb(sessionId: string, actor: UserProfile) {
  const row = getSessionRow(sessionId);
  if (!row) return;
  const now = nowIso();
  let perms: SessionPermissions;
  try {
    perms = JSON.parse(String(row.permissions_json)) as SessionPermissions;
  } catch {
    perms = {
      profileName: 'View Only',
      canViewScreen: true,
      canControlInput: false,
      canShareClipboard: false,
      canTransferFiles: false,
      canRecordSession: false,
      unattendedAccess: false,
      emergencyStoppedAt: null,
      updatedByUid: actor.uid,
      updatedAt: now,
    };
  }
  perms = {
    ...perms,
    canControlInput: false,
    canShareClipboard: false,
    canTransferFiles: false,
    canRecordSession: false,
    unattendedAccess: false,
    updatedByUid: actor.uid,
    updatedAt: now,
  };
  db.prepare(
    `UPDATE sessions
     SET status = 'expired', ended_at = ?, ended_by_uid = ?, end_reason = 'Session code expired',
         permissions_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, actor.uid, JSON.stringify(perms), now, String(row.id));
}

export function approveSessionInDb(
  sessionId: string,
  host: UserProfile,
  perms: {
    profileName: 'Default' | 'View Only' | 'Full Support';
    canViewScreen: boolean;
    canControlInput: boolean;
    canShareClipboard: boolean;
    canTransferFiles: boolean;
    canRecordSession: boolean;
  }
): RemoteSession {
  const row = getSessionRow(sessionId);
  if (!row) throw new Error('Session not found.');
  if (String(row.host_uid) !== host.uid) {
    throw new Error('Only the session host can approve this connection.');
  }
  if (!['waiting', 'pending_approval', 'active'].includes(String(row.status))) {
    throw new Error('Session is no longer open for approval.');
  }

  const settings = getAppSettings();
  const canRecord = settings.allowSessionRecording && Boolean(perms.canRecordSession);
  const now = nowIso();
  const startedAt =
    typeof row.started_at === 'string' && row.started_at ? row.started_at : now;

  const nextPerms: SessionPermissions = {
    profileName: perms.profileName,
    canViewScreen: Boolean(perms.canViewScreen),
    canControlInput: Boolean(perms.canControlInput),
    canShareClipboard: Boolean(perms.canShareClipboard),
    canTransferFiles: Boolean(perms.canTransferFiles),
    canRecordSession: canRecord,
    unattendedAccess: false,
    emergencyStoppedAt: null,
    updatedByUid: host.uid,
    updatedAt: now,
  };

  db.prepare(
    `UPDATE sessions
     SET status = 'active', started_at = ?, permissions_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(startedAt, JSON.stringify(nextPerms), now, String(row.id));

  db.prepare(
    `INSERT INTO session_messages (
      id, session_id, host_uid, technician_uid, sender_uid, sender_name, message_type, body, created_at
    ) VALUES (?, ?, ?, ?, ?, 'Vetiva Security', 'system', ?, ?)`
  ).run(
    crypto.randomUUID(),
    String(row.id),
    String(row.host_uid),
    typeof row.technician_uid === 'string' ? row.technician_uid : null,
    host.uid,
    `${host.displayName} approved connection (${perms.profileName} profile).`,
    now
  );

  recordAuditLog({
    actorUid: host.uid,
    actorEmail: host.email,
    sessionId: String(row.id),
    action: 'session.approved',
    severity: 'info',
    metadata: { ...perms, canRecordSession: canRecord },
  });

  return getSessionById(String(row.id))!;
}

export function rejectSessionInDb(sessionId: string, host: UserProfile): RemoteSession {
  const row = getSessionRow(sessionId);
  if (!row) throw new Error('Session not found.');
  if (String(row.host_uid) !== host.uid) {
    throw new Error('Only the session host can dismiss this request.');
  }
  const now = nowIso();

  db.prepare(
    `UPDATE sessions SET status = 'waiting', technician_uid = NULL, updated_at = ? WHERE id = ?`
  ).run(now, String(row.id));

  db.prepare(
    `INSERT INTO session_messages (
      id, session_id, host_uid, technician_uid, sender_uid, sender_name, message_type, body, created_at
    ) VALUES (?, ?, ?, NULL, ?, 'Vetiva Security', 'system', ?, ?)`
  ).run(
    crypto.randomUUID(),
    String(row.id),
    String(row.host_uid),
    host.uid,
    `${host.displayName} dismissed the incoming connection request.`,
    now
  );

  recordAuditLog({
    actorUid: host.uid,
    actorEmail: host.email,
    sessionId: String(row.id),
    action: 'session.rejected',
    severity: 'warning',
  });

  return getSessionById(String(row.id))!;
}

export function updatePermissionsInDb(
  sessionId: string,
  actor: UserProfile,
  updates: {
    profileName?: 'Default' | 'View Only' | 'Full Support' | 'Custom';
    canViewScreen?: boolean;
    canControlInput?: boolean;
    canShareClipboard?: boolean;
    canTransferFiles?: boolean;
    canRecordSession?: boolean;
    emergencyStop?: boolean;
  }
): RemoteSession {
  const row = getSessionRow(sessionId);
  if (!row) throw new Error('Session not found.');

  const isHost = String(row.host_uid) === actor.uid;
  const isTech = String(row.technician_uid || '') === actor.uid;
  if (!isHost && !(updates.emergencyStop && isTech)) {
    throw new Error('Only the session host can update remote permissions.');
  }

  let existing: SessionPermissions;
  try {
    existing = JSON.parse(String(row.permissions_json)) as SessionPermissions;
  } catch {
    existing = {
      profileName: 'View Only',
      canViewScreen: true,
      canControlInput: false,
      canShareClipboard: false,
      canTransferFiles: false,
      canRecordSession: false,
      unattendedAccess: false,
      emergencyStoppedAt: null,
      updatedByUid: actor.uid,
      updatedAt: nowIso(),
    };
  }

  const settings = getAppSettings();
  const now = nowIso();
  const nextPerms: SessionPermissions = updates.emergencyStop
    ? {
        profileName: 'View Only',
        canViewScreen: existing.canViewScreen ?? true,
        canControlInput: false,
        canShareClipboard: false,
        canTransferFiles: false,
        canRecordSession: false,
        unattendedAccess: false,
        emergencyStoppedAt: now,
        updatedByUid: actor.uid,
        updatedAt: now,
      }
    : {
        profileName: updates.profileName ?? existing.profileName ?? 'Custom',
        canViewScreen: updates.canViewScreen ?? existing.canViewScreen ?? true,
        canControlInput: updates.canControlInput ?? existing.canControlInput ?? false,
        canShareClipboard: updates.canShareClipboard ?? existing.canShareClipboard ?? false,
        canTransferFiles: updates.canTransferFiles ?? existing.canTransferFiles ?? false,
        canRecordSession: settings.allowSessionRecording
          ? (updates.canRecordSession ?? existing.canRecordSession ?? false)
          : false,
        unattendedAccess: false,
        emergencyStoppedAt: existing.emergencyStoppedAt ?? null,
        updatedByUid: actor.uid,
        updatedAt: now,
      };

  db.prepare(
    'UPDATE sessions SET permissions_json = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(nextPerms), now, String(row.id));

  db.prepare(
    `INSERT INTO session_messages (
      id, session_id, host_uid, technician_uid, sender_uid, sender_name, message_type, body, created_at
    ) VALUES (?, ?, ?, ?, ?, 'Vetiva Security', 'system', ?, ?)`
  ).run(
    crypto.randomUUID(),
    String(row.id),
    String(row.host_uid),
    typeof row.technician_uid === 'string' ? row.technician_uid : null,
    actor.uid,
    updates.emergencyStop
      ? `EMERGENCY STOP activated by ${actor.displayName}. All remote input, clipboard, file transfer, and recording revoked.`
      : `${actor.displayName} updated permissions (Control: ${nextPerms.canControlInput ? 'On' : 'Off'}, Clipboard: ${nextPerms.canShareClipboard ? 'On' : 'Off'}, Files: ${nextPerms.canTransferFiles ? 'On' : 'Off'}).`,
    now
  );

  recordAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    sessionId: String(row.id),
    action: updates.emergencyStop ? 'session.emergency_stop' : 'session.permissions_updated',
    severity: updates.emergencyStop ? 'critical' : 'info',
    metadata: {
      canControlInput: nextPerms.canControlInput,
      canShareClipboard: nextPerms.canShareClipboard,
      canTransferFiles: nextPerms.canTransferFiles,
      canRecordSession: nextPerms.canRecordSession,
    },
  });

  return getSessionById(String(row.id))!;
}

export function updateTelemetryInDb(
  sessionId: string,
  actorUid: string,
  latencyMs: number
) {
  const row = getSessionRow(sessionId);
  if (!row) return;
  if (
    String(row.host_uid) !== actorUid &&
    String(row.technician_uid || '') !== actorUid
  ) {
    return;
  }
  const clamped = Math.max(0, Math.min(Math.round(latencyMs), 9999));
  const quality =
    clamped === 0
      ? 'good'
      : clamped < 50
        ? 'excellent'
        : clamped < 140
          ? 'good'
          : 'fair';

  db.prepare(
    'UPDATE sessions SET latency_ms = ?, connection_quality = ?, updated_at = ? WHERE id = ?'
  ).run(clamped, quality, nowIso(), String(row.id));
}

export function disconnectSessionInDb(
  sessionId: string,
  actor: UserProfile,
  reason?: string
): RemoteSession | null {
  const row = getSessionRow(sessionId);
  if (!row) return null;
  if (
    actor.roleSlug !== 'admin' &&
    String(row.host_uid) !== actor.uid &&
    String(row.technician_uid || '') !== actor.uid
  ) {
    throw new Error('You are not authorized to end this session.');
  }
  if (row.status === 'ended' || row.status === 'expired') {
    return getSessionById(String(row.id));
  }

  const now = nowIso();
  const cleanReason =
    reason?.trim().slice(0, 160) || `Terminated by ${actor.displayName}`;

  let perms: SessionPermissions;
  try {
    perms = JSON.parse(String(row.permissions_json)) as SessionPermissions;
  } catch {
    perms = {
      profileName: 'View Only',
      canViewScreen: true,
      canControlInput: false,
      canShareClipboard: false,
      canTransferFiles: false,
      canRecordSession: false,
      unattendedAccess: false,
      emergencyStoppedAt: null,
      updatedByUid: actor.uid,
      updatedAt: now,
    };
  }
  perms = {
    ...perms,
    canControlInput: false,
    canShareClipboard: false,
    canTransferFiles: false,
    canRecordSession: false,
    unattendedAccess: false,
    updatedByUid: actor.uid,
    updatedAt: now,
  };

  db.prepare(
    `UPDATE sessions
     SET status = 'ended', ended_at = ?, ended_by_uid = ?, end_reason = ?,
         permissions_json = ?, updated_at = ?
     WHERE id = ?`
  ).run(now, actor.uid, cleanReason, JSON.stringify(perms), now, String(row.id));

  db.prepare(
    `INSERT INTO session_messages (
      id, session_id, host_uid, technician_uid, sender_uid, sender_name, message_type, body, created_at
    ) VALUES (?, ?, ?, ?, ?, 'Vetiva Security', 'system', ?, ?)`
  ).run(
    crypto.randomUUID(),
    String(row.id),
    String(row.host_uid),
    typeof row.technician_uid === 'string' ? row.technician_uid : null,
    actor.uid,
    `Session ended (${cleanReason}).`,
    now
  );

  recordAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    sessionId: String(row.id),
    action: 'session.disconnected',
    severity: 'info',
    metadata: { reason: cleanReason },
  });

  return getSessionById(String(row.id));
}

export function addSessionMessageInDb(
  sessionId: string,
  actor: UserProfile,
  body: string
): SessionMessage {
  const row = getSessionRow(sessionId);
  if (!row) throw new Error('Session not found.');
  if (
    actor.roleSlug !== 'admin' &&
    String(row.host_uid) !== actor.uid &&
    String(row.technician_uid || '') !== actor.uid
  ) {
    throw new Error('You are not a participant of this session.');
  }

  const cleanBody = body.trim().slice(0, 2000);
  if (!cleanBody) throw new Error('Message cannot be empty.');
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const techUid = typeof row.technician_uid === 'string' ? row.technician_uid : null;

  db.prepare(
    `INSERT INTO session_messages (
      id, session_id, host_uid, technician_uid, sender_uid, sender_name, message_type, body, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'text', ?, ?)`
  ).run(
    id,
    String(row.id),
    String(row.host_uid),
    techUid,
    actor.uid,
    actor.displayName.slice(0, 100),
    cleanBody,
    createdAt
  );

  return {
    id,
    sessionId: String(row.id),
    hostUid: String(row.host_uid),
    technicianUid: techUid,
    senderUid: actor.uid,
    senderName: actor.displayName,
    messageType: 'text',
    body: cleanBody,
    createdAt,
  };
}

export function recordFileTransferInDb(
  sessionId: string,
  actor: UserProfile,
  fileMeta: {
    originalName: string;
    storedName: string;
    mimeType: string;
    sizeBytes: number;
    sha256Hash: string;
    scanStatus: string;
  }
): FileTransferRecord {
  const row = getSessionRow(sessionId);
  if (!row) throw new Error('Session not found.');
  const id = crypto.randomUUID();
  const createdAt = nowIso();
  const techUid = typeof row.technician_uid === 'string' ? row.technician_uid : null;
  const scanStatus = fileMeta.scanStatus === 'blocked' ? 'blocked' : 'clean';

  db.prepare(
    `INSERT INTO file_transfers (
      id, session_id, host_uid, technician_uid, uploader_uid, original_name,
      stored_name, mime_type, size_bytes, sha256_hash, scan_status, download_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
  ).run(
    id,
    String(row.id),
    String(row.host_uid),
    techUid,
    actor.uid,
    fileMeta.originalName.slice(0, 160),
    fileMeta.storedName.slice(0, 160),
    fileMeta.mimeType.slice(0, 120),
    fileMeta.sizeBytes,
    fileMeta.sha256Hash,
    scanStatus,
    createdAt
  );

  recordAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    sessionId: String(row.id),
    action: 'file.uploaded',
    severity: 'info',
    metadata: {
      fileId: id,
      filename: fileMeta.originalName,
      sizeBytes: fileMeta.sizeBytes,
    },
  });

  return {
    id,
    sessionId: String(row.id),
    hostUid: String(row.host_uid),
    technicianUid: techUid,
    uploaderUid: actor.uid,
    originalName: fileMeta.originalName,
    storedName: fileMeta.storedName,
    mimeType: fileMeta.mimeType,
    sizeBytes: fileMeta.sizeBytes,
    sha256Hash: fileMeta.sha256Hash,
    scanStatus,
    downloadCount: 0,
    createdAt,
  };
}

export function getFileRecordByStoredName(
  storedName: string
): Record<string, unknown> | undefined {
  return db
    .prepare('SELECT * FROM file_transfers WHERE stored_name = ? LIMIT 1')
    .get(storedName) as Record<string, unknown> | undefined;
}

export function incrementFileDownloadInDb(storedName: string, actor: UserProfile) {
  const row = getFileRecordByStoredName(storedName);
  if (!row) return;
  db.prepare('UPDATE file_transfers SET download_count = download_count + 1 WHERE id = ?').run(
    String(row.id)
  );
  recordAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    sessionId: String(row.session_id),
    action: 'file.downloaded',
    severity: 'info',
    metadata: { fileId: String(row.id), filename: String(row.original_name) },
  });
}

export function listSessionsForUser(user: UserProfile): RemoteSession[] {
  const rows =
    user.roleSlug === 'admin'
      ? (db.prepare('SELECT * FROM sessions ORDER BY created_at DESC LIMIT 200').all() as Array<
          Record<string, unknown>
        >)
      : (db
          .prepare(
            'SELECT * FROM sessions WHERE host_uid = ? OR technician_uid = ? ORDER BY created_at DESC LIMIT 200'
          )
          .all(user.uid, user.uid) as Array<Record<string, unknown>>);

  return rows.map((r) => mapSessionRow(r, false));
}

export function fetchHistoryForUser(
  user: UserProfile,
  filters: { status?: string; search?: string }
): RemoteSession[] {
  let list = listSessionsForUser(user);
  if (filters.status && filters.status !== 'all') {
    list = list.filter((s) => s.status === filters.status);
  }
  if (filters.search && filters.search.trim()) {
    const q = filters.search.trim().toLowerCase();
    list = list.filter(
      (s) =>
        s.sessionCode.toLowerCase().includes(q) ||
        s.issueSummary.toLowerCase().includes(q) ||
        s.host?.displayName.toLowerCase().includes(q) ||
        s.host?.email.toLowerCase().includes(q) ||
        s.technician?.displayName.toLowerCase().includes(q) ||
        s.technician?.email.toLowerCase().includes(q)
    );
  }
  return list.slice(0, 100);
}

export function fetchAuditLogsForUser(
  user: UserProfile,
  limitCount = 150
): AuditLogRecord[] {
  const rows =
    user.roleSlug === 'admin'
      ? (db
          .prepare('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?')
          .all(limitCount) as Array<Record<string, unknown>>)
      : (db
          .prepare(
            'SELECT * FROM audit_logs WHERE actor_uid = ? ORDER BY created_at DESC LIMIT ?'
          )
          .all(user.uid, limitCount) as Array<Record<string, unknown>>);

  return rows.map((r) => {
    let metadata: Record<string, unknown> = {};
    try {
      metadata = JSON.parse(String(r.metadata_json)) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
    return {
      id: String(r.id),
      actorUid: String(r.actor_uid),
      actorEmail: typeof r.actor_email === 'string' ? r.actor_email : null,
      sessionId: typeof r.session_id === 'string' ? r.session_id : null,
      action: String(r.action),
      severity: (r.severity as AuditLogRecord['severity']) || 'info',
      metadata,
      createdAt: String(r.created_at),
    };
  });
}

export function fetchDashboardForUser(user: UserProfile): DashboardPayload {
  const allSessions = listSessionsForUser(user);
  const techRows = db
    .prepare(
      "SELECT uid, display_name, department, role_slug, is_online, is_active FROM users WHERE is_active = 1 AND role_slug IN ('admin', 'technician') ORDER BY display_name ASC"
    )
    .all() as Array<Record<string, unknown>>;

  const technicians = techRows.map((t) => ({
    uid: String(t.uid),
    displayName: String(t.display_name),
    department: String(t.department),
    roleSlug: (t.role_slug as UserRole) || 'technician',
  }));

  const onlineTechnicians = techRows
    .filter((t) => Number(t.is_online) === 1)
    .map((t) => ({
      uid: String(t.uid),
      displayName: String(t.display_name),
      department: String(t.department),
      roleSlug: (t.role_slug as UserRole) || 'technician',
      isOnline: true,
      isActive: true,
    }));

  return {
    metrics: {
      totalSessions: allSessions.length,
      activeSessions: allSessions.filter((s) => s.status === 'active').length,
      completedSessions: allSessions.filter((s) => s.status === 'ended').length,
      pendingRequests: allSessions.filter(
        (s) => s.status === 'pending_approval' || s.status === 'waiting'
      ).length,
      onlineTechniciansCount: onlineTechnicians.length,
    },
    onlineTechnicians,
    technicians,
    sessions: allSessions.slice(0, 50),
    recentActivities: fetchAuditLogsForUser(user, 25),
  };
}

export function listDirectoryInDb(search?: string): {
  users: UserProfile[];
  invites: UserInviteRecord[];
} {
  const userRows = db
    .prepare('SELECT * FROM users ORDER BY display_name ASC')
    .all() as Array<Record<string, unknown>>;
  const inviteRows = db
    .prepare('SELECT * FROM invites WHERE claimed = 0 ORDER BY created_at DESC')
    .all() as Array<Record<string, unknown>>;

  let users = userRows.map(mapUserRow);
  let invites: UserInviteRecord[] = inviteRows.map((inv) => ({
    id: String(inv.id),
    email: String(inv.email),
    displayName: String(inv.display_name),
    department: String(inv.department),
    roleSlug: (inv.role_slug as UserRole) || 'employee',
    claimed: Number(inv.claimed) === 1,
    createdAt: String(inv.created_at),
  }));

  if (search && search.trim()) {
    const q = search.trim().toLowerCase();
    users = users.filter(
      (u) =>
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q) ||
        u.department.toLowerCase().includes(q)
    );
    invites = invites.filter(
      (i) =>
        i.email.toLowerCase().includes(q) ||
        i.displayName.toLowerCase().includes(q) ||
        i.department.toLowerCase().includes(q)
    );
  }

  return { users, invites };
}

export function createInviteInDb(
  payload: {
    email: string;
    displayName: string;
    department: string;
    roleSlug: UserRole;
  },
  actor: UserProfile
): UserInviteRecord {
  const id = crypto.randomUUID();
  const cleanEmail = payload.email.trim().toLowerCase().slice(0, 200);
  const cleanName = payload.displayName.trim().slice(0, 100);
  const cleanDept = payload.department.trim().slice(0, 100) || 'Vetiva Operations';
  const now = nowIso();

  db.prepare(
    `INSERT INTO invites (id, email, display_name, department, role_slug, claimed, created_by_uid, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
  ).run(id, cleanEmail, cleanName, cleanDept, payload.roleSlug, actor.uid, now, now);

  recordAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'admin.user_invited',
    severity: 'info',
    metadata: { email: cleanEmail, roleSlug: payload.roleSlug },
  });

  return {
    id,
    email: cleanEmail,
    displayName: cleanName,
    department: cleanDept,
    roleSlug: payload.roleSlug,
    claimed: false,
    createdAt: now,
  };
}

export function revokeInviteInDb(inviteId: string) {
  db.prepare('DELETE FROM invites WHERE id = ?').run(inviteId);
}

export function updateUserInDb(
  targetUid: string,
  updates: { roleSlug?: UserRole; isActive?: boolean },
  actor: UserProfile
): UserProfile {
  const target = getUserByUid(targetUid);
  if (!target) throw new Error('User not found.');
  if (
    target.uid === actor.uid &&
    (updates.isActive === false ||
      (updates.roleSlug && updates.roleSlug !== 'admin'))
  ) {
    throw new Error(
      'You cannot deactivate or demote your own administrator account.'
    );
  }

  const nextRole = updates.roleSlug ?? target.roleSlug;
  const nextActive = updates.isActive ?? target.isActive;
  const now = nowIso();

  db.prepare(
    'UPDATE users SET role_slug = ?, is_active = ?, updated_at = ? WHERE uid = ?'
  ).run(nextRole, nextActive ? 1 : 0, now, targetUid);

  recordAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    action: 'admin.user_updated',
    severity: 'warning',
    metadata: { targetUid, changes: updates },
  });

  return getUserByUid(targetUid)!;
}
