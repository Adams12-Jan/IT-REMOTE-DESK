import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. Roles table
export const roles = pgTable('roles', {
  id: serial('id').primaryKey(),
  slug: text('slug').notNull().unique(), // 'admin' | 'technician' | 'employee'
  name: text('name').notNull(),
  description: text('description').notNull(),
  permissions: jsonb('permissions').$type<string[]>().notNull().default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// 2. Users table (linked via Firebase Auth UID)
export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    department: text('department').notNull().default('Corporate Operations'),
    roleSlug: text('role_slug')
      .references(() => roles.slug)
      .notNull()
      .default('employee'),
    isActive: boolean('is_active').notNull().default(true),
    isOnline: boolean('is_online').notNull().default(false),
    lastSeenAt: timestamp('last_seen_at').defaultNow(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_users_role_slug').on(table.roleSlug),
    index('idx_users_email').on(table.email),
  ]
);

// 3. Registered Devices table
export const devices = pgTable(
  'devices',
  {
    id: serial('id').primaryKey(),
    deviceCode: text('device_code').notNull().unique(), // 9-12 digit persistent device identifier
    ownerId: integer('owner_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    hostname: text('hostname').notNull(),
    osPlatform: text('os_platform').notNull().default('Web Browser'),
    agentVersion: text('agent_version').notNull().default('web-client-1.0'),
    nativeAgentLinked: boolean('native_agent_linked').notNull().default(false),
    lastActiveAt: timestamp('last_active_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_devices_owner_id').on(table.ownerId)]
);

// 4. Remote Support Sessions table
export const sessions = pgTable(
  'sessions',
  {
    id: serial('id').primaryKey(),
    sessionCode: text('session_code').notNull().unique(), // 10-digit unique session ID
    accessTokenHash: text('access_token_hash').notNull(), // SHA-256 hash of single-use access code
    hostUserId: integer('host_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    technicianUserId: integer('technician_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    deviceId: integer('device_id').references(() => devices.id, {
      onDelete: 'set null',
    }),
    status: text('status').notNull().default('waiting'), // 'waiting' | 'pending_approval' | 'active' | 'rejected' | 'ended' | 'expired'
    issueSummary: text('issue_summary').notNull().default('General IT Support'),
    failedJoinAttempts: integer('failed_join_attempts').notNull().default(0),
    isLocked: boolean('is_locked').notNull().default(false),
    connectionQuality: text('connection_quality').notNull().default('good'), // 'excellent' | 'good' | 'fair' | 'poor'
    latencyMs: integer('latency_ms').notNull().default(0),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    expiresAt: timestamp('expires_at').notNull(),
    endedByUserId: integer('ended_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    endReason: text('end_reason'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_sessions_status').on(table.status),
    index('idx_sessions_host_user').on(table.hostUserId),
    index('idx_sessions_tech_user').on(table.technicianUserId),
    index('idx_sessions_created_at').on(table.createdAt),
  ]
);

// 5. Session Permissions table (explicit consent per capability)
export const sessionPermissions = pgTable(
  'session_permissions',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull()
      .unique(),
    profileName: text('profile_name').notNull().default('View Only'), // 'Default' | 'View Only' | 'Full Support'
    canViewScreen: boolean('can_view_screen').notNull().default(true),
    canControlInput: boolean('can_control_input').notNull().default(false),
    canShareClipboard: boolean('can_share_clipboard').notNull().default(false),
    canTransferFiles: boolean('can_transfer_files').notNull().default(false),
    canRecordSession: boolean('can_record_session').notNull().default(false),
    unattendedAccess: boolean('unattended_access').notNull().default(false), // Always false by policy
    emergencyStoppedAt: timestamp('emergency_stopped_at'),
    updatedByUserId: integer('updated_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('idx_session_permissions_session').on(table.sessionId)]
);

// 6. Session Participants table
export const sessionParticipants = pgTable(
  'session_participants',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    participantRole: text('participant_role').notNull(), // 'host' | 'technician' | 'observer'
    connectionState: text('connection_state').notNull().default('connected'),
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
    leftAt: timestamp('left_at'),
  },
  (table) => [
    uniqueIndex('idx_session_participant_unique').on(table.sessionId, table.userId),
  ]
);

// 7. Session Messages (Live Support Chat)
export const sessionMessages = pgTable(
  'session_messages',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    senderUserId: integer('sender_user_id')
      .references(() => users.id, { onDelete: 'set null' }),
    senderName: text('sender_name').notNull(),
    messageType: text('message_type').notNull().default('text'), // 'text' | 'system'
    body: text('body').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_session_messages_session').on(table.sessionId, table.createdAt)]
);

// 8. File Transfers table
export const fileTransfers = pgTable(
  'file_transfers',
  {
    id: serial('id').primaryKey(),
    sessionId: integer('session_id')
      .references(() => sessions.id, { onDelete: 'cascade' })
      .notNull(),
    uploaderUserId: integer('uploader_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    originalName: text('original_name').notNull(),
    storedName: text('stored_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    sha256Hash: text('sha256_hash').notNull(),
    scanStatus: text('scan_status').notNull().default('clean'), // 'clean' | 'blocked'
    downloadCount: integer('download_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('idx_file_transfers_session').on(table.sessionId)]
);

// 9. Audit Logs table
export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    actorEmail: text('actor_email'),
    sessionId: integer('session_id').references(() => sessions.id, {
      onDelete: 'set null',
    }),
    action: text('action').notNull(),
    severity: text('severity').notNull().default('info'), // 'info' | 'warning' | 'critical'
    ipAddress: text('ip_address'),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('idx_audit_logs_created_at').on(table.createdAt),
    index('idx_audit_logs_action').on(table.action),
    index('idx_audit_logs_session').on(table.sessionId),
  ]
);

// 10. Application & Security Settings table
export const appSettings = pgTable('app_settings', {
  id: serial('id').primaryKey(),
  settingKey: text('setting_key').notNull().unique(),
  sessionExpiryMinutes: integer('session_expiry_minutes').notNull().default(60),
  maxFailedAttempts: integer('max_failed_attempts').notNull().default(5),
  maxFileSizeMb: integer('max_file_size_mb').notNull().default(25),
  requireExplicitControlConsent: boolean('require_explicit_control_consent').notNull().default(true),
  allowSessionRecording: boolean('allow_session_recording').notNull().default(true),
  enforceVetivaDomainOnly: boolean('enforce_vetiva_domain_only').notNull().default(false),
  allowedFileExtensions: jsonb('allowed_file_extensions')
    .$type<string[]>()
    .notNull()
    .default(['.pdf', '.png', '.jpg', '.jpeg', '.txt', '.csv', '.log', '.zip', '.docx', '.xlsx']),
  updatedByUserId: integer('updated_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Drizzle Relations
export const rolesRelations = relations(roles, ({ many }) => ({
  users: many(users),
}));

export const usersRelations = relations(users, ({ one, many }) => ({
  role: one(roles, {
    fields: [users.roleSlug],
    references: [roles.slug],
  }),
  devices: many(devices),
  hostedSessions: many(sessions, { relationName: 'hostSessions' }),
  techSessions: many(sessions, { relationName: 'techSessions' }),
}));

export const sessionsRelations = relations(sessions, ({ one, many }) => ({
  host: one(users, {
    fields: [sessions.hostUserId],
    references: [users.id],
    relationName: 'hostSessions',
  }),
  technician: one(users, {
    fields: [sessions.technicianUserId],
    references: [users.id],
    relationName: 'techSessions',
  }),
  permissions: one(sessionPermissions, {
    fields: [sessions.id],
    references: [sessionPermissions.sessionId],
  }),
  participants: many(sessionParticipants),
  messages: many(sessionMessages),
  files: many(fileTransfers),
  auditLogs: many(auditLogs),
}));
