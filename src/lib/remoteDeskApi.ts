import {
  AppSettingsRecord,
  AuditLogRecord,
  DashboardPayload,
  DeviceRecord,
  FileTransferRecord,
  RemoteSession,
  SessionMessage,
  SessionPermissions,
  UserInviteRecord,
  UserProfile,
  UserRole,
} from '../types/remoteDesk';

export type ApiFetchFn = <T = unknown>(
  url: string,
  init?: RequestInit
) => Promise<T>;

export async function syncAuthenticatedProfile(
  apiFetch: ApiFetchFn
): Promise<{ user: UserProfile; device: DeviceRecord }> {
  return apiFetch<{ user: UserProfile; device: DeviceRecord }>('/api/auth/sync', {
    method: 'POST',
  });
}

export async function notifyLogout(apiFetch: ApiFetchFn): Promise<void> {
  await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
}

export async function createRemoteSession(
  apiFetch: ApiFetchFn,
  params: { deviceId: string; issueSummary: string }
): Promise<{ session: RemoteSession; accessToken: string }> {
  return apiFetch<{ session: RemoteSession; accessToken: string }>(
    '/api/sessions',
    {
      method: 'POST',
      body: JSON.stringify(params),
    }
  );
}

export async function joinRemoteSession(
  apiFetch: ApiFetchFn,
  params: { sessionCode: string; accessToken: string }
): Promise<RemoteSession> {
  const res = await apiFetch<{ session: RemoteSession }>('/api/sessions/join', {
    method: 'POST',
    body: JSON.stringify(params),
  });
  return res.session;
}

export async function getSessionByIdApi(
  apiFetch: ApiFetchFn,
  sessionId: string
): Promise<RemoteSession> {
  const res = await apiFetch<{ session: RemoteSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}`
  );
  return res.session;
}

export async function approveIncomingSession(
  apiFetch: ApiFetchFn,
  sessionId: string,
  perms: {
    profileName: 'Default' | 'View Only' | 'Full Support';
    canViewScreen: boolean;
    canControlInput: boolean;
    canShareClipboard: boolean;
    canTransferFiles: boolean;
    canRecordSession: boolean;
  }
): Promise<RemoteSession> {
  const res = await apiFetch<{ session: RemoteSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/approve`,
    {
      method: 'POST',
      body: JSON.stringify(perms),
    }
  );
  return res.session;
}

export async function rejectIncomingSession(
  apiFetch: ApiFetchFn,
  sessionId: string
): Promise<RemoteSession> {
  const res = await apiFetch<{ session: RemoteSession }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/reject`,
    {
      method: 'POST',
    }
  );
  return res.session;
}

export async function updateSessionPermissions(
  apiFetch: ApiFetchFn,
  sessionId: string,
  updates: {
    profileName?: 'Default' | 'View Only' | 'Full Support' | 'Custom';
    canViewScreen?: boolean;
    canControlInput?: boolean;
    canShareClipboard?: boolean;
    canTransferFiles?: boolean;
    canRecordSession?: boolean;
    emergencyStop?: boolean;
  }
): Promise<{ session: RemoteSession; permissions: SessionPermissions }> {
  return apiFetch<{ session: RemoteSession; permissions: SessionPermissions }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/permissions`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  );
}

export async function disconnectSession(
  apiFetch: ApiFetchFn,
  sessionId: string,
  reason?: string
): Promise<void> {
  await apiFetch(`/api/sessions/${encodeURIComponent(sessionId)}/disconnect`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function sendSessionMessage(
  apiFetch: ApiFetchFn,
  sessionId: string,
  body: string
): Promise<SessionMessage> {
  const res = await apiFetch<{ message: SessionMessage }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/messages`,
    {
      method: 'POST',
      body: JSON.stringify({ body }),
    }
  );
  return res.message;
}

export async function uploadSessionFile(
  apiFetch: ApiFetchFn,
  sessionId: string,
  file: File
): Promise<FileTransferRecord> {
  const formData = new FormData();
  formData.append('sessionId', sessionId);
  formData.append('file', file);
  const res = await apiFetch<{ file: FileTransferRecord }>('/api/files/upload', {
    method: 'POST',
    body: formData,
  });
  return res.file;
}

export async function fetchDashboardData(
  apiFetch: ApiFetchFn
): Promise<DashboardPayload> {
  return apiFetch<DashboardPayload>('/api/dashboard');
}

export async function fetchSessionHistory(
  apiFetch: ApiFetchFn,
  filters: { status?: string; search?: string }
): Promise<RemoteSession[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.search) params.set('search', filters.search);
  const res = await apiFetch<{ sessions: RemoteSession[] }>(
    `/api/history?${params.toString()}`
  );
  return res.sessions;
}

export async function listCorporateDirectory(
  apiFetch: ApiFetchFn,
  search?: string
): Promise<{
  users: UserProfile[];
  invites: UserInviteRecord[];
}> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  return apiFetch<{ users: UserProfile[]; invites: UserInviteRecord[] }>(
    `/api/users?${params.toString()}`
  );
}

export async function createCorporateInvite(
  apiFetch: ApiFetchFn,
  payload: {
    email: string;
    displayName: string;
    department: string;
    roleSlug: UserRole;
  }
): Promise<UserInviteRecord> {
  const res = await apiFetch<{ invite: UserInviteRecord }>('/api/invites', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return res.invite;
}

export async function revokeCorporateInvite(
  apiFetch: ApiFetchFn,
  inviteId: string
): Promise<void> {
  await apiFetch(`/api/invites/${encodeURIComponent(inviteId)}`, {
    method: 'DELETE',
  });
}

export async function updateCorporateUser(
  apiFetch: ApiFetchFn,
  targetUid: string,
  updates: { roleSlug?: UserRole; isActive?: boolean }
): Promise<UserProfile> {
  const res = await apiFetch<{ user: UserProfile }>(
    `/api/users/${encodeURIComponent(targetUid)}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates),
    }
  );
  return res.user;
}

export async function fetchSettingsAndLogs(
  apiFetch: ApiFetchFn
): Promise<{ settings: AppSettingsRecord; logs: AuditLogRecord[] }> {
  return apiFetch<{ settings: AppSettingsRecord; logs: AuditLogRecord[] }>(
    '/api/settings'
  );
}

export async function updateSettingsPolicy(
  apiFetch: ApiFetchFn,
  updates: {
    sessionExpiryMinutes: number;
    maxFailedAttempts: number;
    maxFileSizeMb: number;
    requireExplicitControlConsent: boolean;
    allowSessionRecording: boolean;
    enforceVetivaDomainOnly: boolean;
    allowedFileExtensions: string[];
  }
): Promise<AppSettingsRecord> {
  const res = await apiFetch<{ settings: AppSettingsRecord }>('/api/settings', {
    method: 'PUT',
    body: JSON.stringify(updates),
  });
  return res.settings;
}
