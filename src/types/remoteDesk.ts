export type UserRole = 'admin' | 'technician' | 'employee';

export interface UserProfile {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  department: string;
  roleSlug: UserRole;
  isActive: boolean;
  isOnline?: boolean;
  lastSeenAt?: string;
}

export interface DeviceRecord {
  id: number;
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
  id: number;
  sessionId: number;
  profileName: string;
  canViewScreen: boolean;
  canControlInput: boolean;
  canShareClipboard: boolean;
  canTransferFiles: boolean;
  canRecordSession: boolean;
  unattendedAccess: boolean;
  emergencyStoppedAt?: string | null;
  updatedAt: string;
}

export interface SessionMessage {
  id: number;
  sessionId: number;
  senderUserId?: number | null;
  senderName: string;
  messageType: 'text' | 'system';
  body: string;
  createdAt: string;
}

export interface FileTransferRecord {
  id: number;
  sessionId: number;
  uploaderUserId: number;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  sha256Hash: string;
  scanStatus: string;
  downloadCount: number;
  createdAt: string;
}

export interface SessionParticipantSummary {
  id: number;
  uid?: string;
  displayName: string;
  email: string;
  department: string;
  roleSlug: UserRole;
  isOnline?: boolean;
}

export interface RemoteSession {
  id: number;
  sessionCode: string;
  hostUserId: number;
  technicianUserId: number | null;
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
  id: number;
  actorUserId: number | null;
  actorEmail: string | null;
  sessionId: number | null;
  action: string;
  severity: 'info' | 'warning' | 'critical';
  ipAddress: string | null;
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
  onlineTechnicians: SessionParticipantSummary[];
  technicians: SessionParticipantSummary[];
  employees: SessionParticipantSummary[];
  sessions: Array<Omit<RemoteSession, 'permissions' | 'messages' | 'files'>>;
  recentActivities: AuditLogRecord[];
}

export interface AppSettingsRecord {
  id: number;
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
