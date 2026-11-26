export type UserRole = 'admin' | 'technician' | 'employee';

export interface UserProfile {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  department: string;
  roleSlug: UserRole;
  isActive: boolean;
  isOnline?: boolean;
  lastSeenAt?: string;
}

export interface UserInviteRecord {
  id: string;
  email: string;
  displayName: string;
  department: string;
  roleSlug: UserRole;
  claimed: boolean;
  createdAt: string;
}

export interface DeviceRecord {
  id: string;
  deviceCode: string;
  hostname: string;
  osPlatform: string;
  agentVersion: string;
  nativeAgentLinked: boolean;
}

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface SessionPermissions {
  profileName: string;
  canViewScreen: boolean;
  canControlInput: boolean;
  canShareClipboard: boolean;
  canTransferFiles: boolean;
  canRecordSession: boolean;
  unattendedAccess: boolean;
  emergencyStoppedAt?: string | null;
  updatedByUid?: string;
  updatedAt: string;
}

export interface SessionMessage {
  id: string;
  sessionId: string;
  hostUid: string;
  technicianUid: string | null;
  senderUid?: string | null;
  senderName: string;
  messageType: 'text' | 'system';
  body: string;
  createdAt: string;
}

export interface FileTransferRecord {
  id: string;
  sessionId: string;
  hostUid: string;
  technicianUid: string | null;
  uploaderUid: string;
  originalName: string;
  storedName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  scanStatus: string;
  downloadCount: number;
  createdAt: string;
}

export interface SessionParticipantSummary {
  uid: string;
  displayName: string;
  email: string;
  department: string;
  roleSlug: UserRole;
  isOnline?: boolean;
}

export interface RemoteSession {
  id: string;
  sessionCode: string;
  hostUid: string;
  technicianUid: string | null;
  deviceId: string;
  status: 'waiting' | 'pending_approval' | 'active' | 'rejected' | 'ended' | 'expired';
  issueSummary: string;
  connectionQuality: string;
  latencyMs: number;
  startedAt: string | null;
  endedAt: string | null;
  expiresAt: string;
  endReason: string | null;
  createdAt: string;
  host: SessionParticipantSummary | null;
  technician: SessionParticipantSummary | null;
  permissions: SessionPermissions | null;
  messages: SessionMessage[];
  files: FileTransferRecord[];
}

export interface AuditLogRecord {
  id: string;
  actorUid: string;
  actorEmail: string | null;
  sessionId: string | null;
  action: string;
  severity: 'info' | 'warning' | 'critical';
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface DashboardPayload {
  metrics: {
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    pendingRequests: number;
    onlineTechniciansCount: number;
  };
  onlineTechnicians: Array<{
    uid: string;
    displayName: string;
    department: string;
    roleSlug: UserRole;
    isOnline: boolean;
    isActive: boolean;
  }>;
  technicians: Array<{
    uid: string;
    displayName: string;
    department: string;
    roleSlug: UserRole;
  }>;
  sessions: Array<Omit<RemoteSession, 'messages' | 'files'>>;
  recentActivities: AuditLogRecord[];
}

export interface AppSettingsRecord {
  settingKey: string;
  sessionExpiryMinutes: number;
  maxFailedAttempts: number;
  maxFileSizeMb: number;
  requireExplicitControlConsent: boolean;
  allowSessionRecording: boolean;
  enforceVetivaDomainOnly: boolean;
  allowedFileExtensions: string[];
  updatedAt: string;
}
