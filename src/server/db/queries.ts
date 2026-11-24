import { and, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import {
  appSettings,
  auditLogs,
  devices,
  fileTransfers,
  roles,
  sessionMessages,
  sessionParticipants,
  sessionPermissions,
  sessions,
  users,
} from '../../db/schema.ts';
import { generateDeviceCode } from '../security.ts';

let seedEnsured = false;

export async function ensureBaseSeed() {
  if (seedEnsured) return;
  try {
    await db
      .insert(roles)
      .values([
        {
          slug: 'admin',
          name: 'Administrator',
          description:
            'Full administrative control over users, IT support technicians, security settings, and audit logs.',
          permissions: [
            'manage:users',
            'manage:settings',
            'view:all_sessions',
            'view:audit_logs',
            'join:session',
            'share:desk',
          ],
        },
        {
          slug: 'technician',
          name: 'IT Support Technician',
          description:
            'Connect to authorized employee desks, request remote control, transfer approved files, and chat.',
          permissions: [
            'join:session',
            'request:control',
            'transfer:files',
            'view:assigned_sessions',
            'share:desk',
          ],
        },
        {
          slug: 'employee',
          name: 'End User / Employee',
          description:
            'Share workstation screen, approve or reject incoming support connections, and control session permissions.',
          permissions: [
            'share:desk',
            'approve:session',
            'control:permissions',
            'view:own_sessions',
          ],
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(appSettings)
      .values({
        settingKey: 'default',
        sessionExpiryMinutes: 60,
        maxFailedAttempts: 5,
        maxFileSizeMb: 25,
        requireExplicitControlConsent: true,
        allowSessionRecording: true,
        enforceVetivaDomainOnly: false,
      })
      .onConflictDoNothing();

    seedEnsured = true;
  } catch (error) {
    console.error('Database seed initialization failed:', error);
    throw new Error('Failed to initialize application defaults.', {
      cause: error,
    });
  }
}

export async function getOrCreateUser(
  uid: string,
  email: string,
  displayName: string
) {
  try {
    await ensureBaseSeed();

    const normalizedEmail = email.trim().toLowerCase();
    const existingByUid = await db
      .select()
      .from(users)
      .where(eq(users.uid, uid))
      .limit(1);

    if (existingByUid.length > 0) {
      const updated = await db
        .update(users)
        .set({
          email: normalizedEmail,
          displayName: existingByUid[0].displayName || displayName,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByUid[0].id))
        .returning();
      return updated[0];
    }

    // Check if an admin pre-invited this email
    const existingByEmail = await db
      .select()
      .from(users)
      .where(eq(users.email, normalizedEmail))
      .limit(1);

    if (existingByEmail.length > 0) {
      const claimed = await db
        .update(users)
        .set({
          uid,
          displayName: existingByEmail[0].displayName || displayName,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingByEmail[0].id))
        .returning();
      return claimed[0];
    }

    // Determine initial role: workspace owner or first user gets admin
    const existingAdmin = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.roleSlug, 'admin'))
      .limit(1);

    const bootstrapAdminEmail = (
      process.env.INITIAL_ADMIN_EMAIL || 'gideonline18@gmail.com'
    )
      .trim()
      .toLowerCase();

    const defaultRole =
      existingAdmin.length === 0 || normalizedEmail === bootstrapAdminEmail
        ? 'admin'
        : 'employee';

    const inserted = await db
      .insert(users)
      .values({
        uid,
        email: normalizedEmail,
        displayName,
        roleSlug: defaultRole,
        department:
          defaultRole === 'admin' ? 'IT Infrastructure & Security' : 'Vetiva Operations',
        isActive: true,
        isOnline: true,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          uid,
          lastSeenAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    return inserted[0];
  } catch (error) {
    console.error('Database query failed in getOrCreateUser:', error);
    throw new Error('Failed to synchronize user account.', { cause: error });
  }
}

export async function getOrCreatePrimaryDevice(
  userId: number,
  displayName: string,
  userAgent?: string
) {
  try {
    const existing = await db
      .select()
      .from(devices)
      .where(eq(devices.ownerId, userId))
      .limit(1);

    if (existing.length > 0) {
      const updated = await db
        .update(devices)
        .set({ lastActiveAt: new Date() })
        .where(eq(devices.id, existing[0].id))
        .returning();
      return updated[0];
    }

    const platform = userAgent?.includes('Win')
      ? 'Windows Workstation'
      : userAgent?.includes('Mac')
        ? 'macOS Workstation'
        : userAgent?.includes('Linux')
          ? 'Linux Workstation'
          : 'Web Browser';

    const hostnamePrefix = displayName
      .replace(/[^a-zA-Z0-9]/g, '')
      .toUpperCase()
      .slice(0, 8) || 'VETIVA';

    const created = await db
      .insert(devices)
      .values({
        deviceCode: generateDeviceCode(),
        ownerId: userId,
        hostname: `${hostnamePrefix}-WS01`,
        osPlatform: platform,
        agentVersion: 'web-client-1.0',
        nativeAgentLinked: false,
      })
      .returning();

    return created[0];
  } catch (error) {
    console.error('Database query failed in getOrCreatePrimaryDevice:', error);
    throw new Error('Failed to register workstation device.', { cause: error });
  }
}

export async function setUserOnlineState(userId: number, isOnline: boolean) {
  try {
    await db
      .update(users)
      .set({
        isOnline,
        lastSeenAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(users.id, userId));
  } catch (error) {
    console.error('Database query failed in setUserOnlineState:', error);
  }
}

export async function getAppSettings() {
  try {
    await ensureBaseSeed();
    const rows = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.settingKey, 'default'))
      .limit(1);
    return rows[0];
  } catch (error) {
    console.error('Database query failed in getAppSettings:', error);
    throw new Error('Failed to load application settings.', { cause: error });
  }
}

export async function updateAppSettings(
  updates: {
    sessionExpiryMinutes?: number;
    maxFailedAttempts?: number;
    maxFileSizeMb?: number;
    requireExplicitControlConsent?: boolean;
    allowSessionRecording?: boolean;
    enforceVetivaDomainOnly?: boolean;
    allowedFileExtensions?: string[];
  },
  updatedByUserId: number
) {
  try {
    await ensureBaseSeed();
    const updated = await db
      .update(appSettings)
      .set({
        ...updates,
        updatedByUserId,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.settingKey, 'default'))
      .returning();
    return updated[0];
  } catch (error) {
    console.error('Database query failed in updateAppSettings:', error);
    throw new Error('Failed to update security settings.', { cause: error });
  }
}

export async function recordAuditLog(params: {
  actorUserId?: number | null;
  actorEmail?: string | null;
  sessionId?: number | null;
  action: string;
  severity?: 'info' | 'warning' | 'critical';
  ipAddress?: string | null;
  metadata?: Record<string, unknown>;
}) {
  try {
    await db.insert(auditLogs).values({
      actorUserId: params.actorUserId ?? null,
      actorEmail: params.actorEmail ?? null,
      sessionId: params.sessionId ?? null,
      action: params.action,
      severity: params.severity ?? 'info',
      ipAddress: params.ipAddress ?? null,
      metadata: params.metadata ?? {},
    });
  } catch (error) {
    console.error('Failed to write audit log:', error);
  }
}

export async function createRemoteSession(params: {
  sessionCode: string;
  accessTokenHash: string;
  hostUserId: number;
  deviceId: number;
  issueSummary: string;
  expiresAt: Date;
}) {
  try {
    const [session] = await db
      .insert(sessions)
      .values({
        sessionCode: params.sessionCode,
        accessTokenHash: params.accessTokenHash,
        hostUserId: params.hostUserId,
        deviceId: params.deviceId,
        status: 'waiting',
        issueSummary: params.issueSummary,
        expiresAt: params.expiresAt,
      })
      .returning();

    const [perms] = await db
      .insert(sessionPermissions)
      .values({
        sessionId: session.id,
        profileName: 'View Only',
        canViewScreen: true,
        canControlInput: false,
        canShareClipboard: false,
        canTransferFiles: false,
        canRecordSession: false,
        unattendedAccess: false,
        updatedByUserId: params.hostUserId,
      })
      .returning();

    await db
      .insert(sessionParticipants)
      .values({
        sessionId: session.id,
        userId: params.hostUserId,
        participantRole: 'host',
        connectionState: 'connected',
      })
      .onConflictDoNothing();

    await db.insert(sessionMessages).values({
      sessionId: session.id,
      senderUserId: null,
      senderName: 'Vetiva Security',
      messageType: 'system',
      body: `Session ${params.sessionCode} initialized. Waiting for authorized IT Support connection.`,
    });

    return { session, permissions: perms };
  } catch (error) {
    console.error('Database query failed in createRemoteSession:', error);
    throw new Error('Failed to create remote support session.', {
      cause: error,
    });
  }
}

export async function findSessionByIdOrCode(idOrCode: string | number) {
  try {
    const asNumber = Number(idOrCode);
    const isSmallId =
      typeof idOrCode === 'number' ||
      (/^\d+$/.test(String(idOrCode)) && String(idOrCode).length <= 8);

    const rows = await db
      .select()
      .from(sessions)
      .where(
        isSmallId && !Number.isNaN(asNumber)
          ? eq(sessions.id, asNumber)
          : eq(sessions.sessionCode, String(idOrCode).replace(/\s+/g, ''))
      )
      .limit(1);

    return rows[0] ?? null;
  } catch (error) {
    console.error('Database query failed in findSessionByIdOrCode:', error);
    throw new Error('Failed to look up remote session.', { cause: error });
  }
}

export async function getHydratedSession(sessionId: number) {
  try {
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId))
      .limit(1);

    if (!session) return null;

    const [host] = await db
      .select({
        id: users.id,
        uid: users.uid,
        email: users.email,
        displayName: users.displayName,
        department: users.department,
        roleSlug: users.roleSlug,
        isOnline: users.isOnline,
      })
      .from(users)
      .where(eq(users.id, session.hostUserId))
      .limit(1);

    const technician = session.technicianUserId
      ? (
          await db
            .select({
              id: users.id,
              uid: users.uid,
              email: users.email,
              displayName: users.displayName,
              department: users.department,
              roleSlug: users.roleSlug,
              isOnline: users.isOnline,
            })
            .from(users)
            .where(eq(users.id, session.technicianUserId))
            .limit(1)
        )[0] ?? null
      : null;

    const [permissions] = await db
      .select()
      .from(sessionPermissions)
      .where(eq(sessionPermissions.sessionId, session.id))
      .limit(1);

    const messages = await db
      .select()
      .from(sessionMessages)
      .where(eq(sessionMessages.sessionId, session.id))
      .orderBy(sessionMessages.createdAt);

    const files = await db
      .select({
        id: fileTransfers.id,
        sessionId: fileTransfers.sessionId,
        uploaderUserId: fileTransfers.uploaderUserId,
        originalName: fileTransfers.originalName,
        mimeType: fileTransfers.mimeType,
        sizeBytes: fileTransfers.sizeBytes,
        sha256Hash: fileTransfers.sha256Hash,
        scanStatus: fileTransfers.scanStatus,
        downloadCount: fileTransfers.downloadCount,
        createdAt: fileTransfers.createdAt,
      })
      .from(fileTransfers)
      .where(eq(fileTransfers.sessionId, session.id))
      .orderBy(desc(fileTransfers.createdAt));

    const { accessTokenHash: _redacted, ...safeSession } = session;

    return {
      ...safeSession,
      host: host ?? null,
      technician,
      permissions: permissions ?? null,
      messages,
      files,
    };
  } catch (error) {
    console.error('Database query failed in getHydratedSession:', error);
    throw new Error('Failed to load session details.', { cause: error });
  }
}

export async function listSessionHistory(filters: {
  userId: number;
  roleSlug: string;
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  technicianId?: number;
}) {
  try {
    const conditions = [];

    if (filters.roleSlug === 'employee') {
      conditions.push(
        or(
          eq(sessions.hostUserId, filters.userId),
          eq(sessions.technicianUserId, filters.userId)
        )
      );
    }

    if (filters.status && filters.status !== 'all') {
      conditions.push(eq(sessions.status, filters.status));
    }

    if (filters.technicianId) {
      conditions.push(eq(sessions.technicianUserId, filters.technicianId));
    }

    if (filters.dateFrom) {
      const fromDate = new Date(filters.dateFrom);
      if (!Number.isNaN(fromDate.getTime())) {
        conditions.push(gte(sessions.createdAt, fromDate));
      }
    }

    if (filters.dateTo) {
      const toDate = new Date(filters.dateTo);
      if (!Number.isNaN(toDate.getTime())) {
        toDate.setHours(23, 59, 59, 999);
        conditions.push(lte(sessions.createdAt, toDate));
      }
    }

    const rows = await db
      .select()
      .from(sessions)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(sessions.createdAt))
      .limit(100);

    const allUsers = await db
      .select({
        id: users.id,
        displayName: users.displayName,
        email: users.email,
        department: users.department,
        roleSlug: users.roleSlug,
      })
      .from(users);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const hydrated = rows.map((s) => {
      const { accessTokenHash: _redacted, ...safe } = s;
      return {
        ...safe,
        host: userMap.get(s.hostUserId) ?? null,
        technician: s.technicianUserId
          ? userMap.get(s.technicianUserId) ?? null
          : null,
      };
    });

    if (filters.search && filters.search.trim().length > 0) {
      const q = filters.search.trim().toLowerCase();
      return hydrated.filter(
        (s) =>
          s.sessionCode.toLowerCase().includes(q) ||
          s.issueSummary.toLowerCase().includes(q) ||
          s.host?.displayName.toLowerCase().includes(q) ||
          s.host?.email.toLowerCase().includes(q) ||
          s.technician?.displayName.toLowerCase().includes(q) ||
          s.technician?.email.toLowerCase().includes(q)
      );
    }

    return hydrated;
  } catch (error) {
    console.error('Database query failed in listSessionHistory:', error);
    throw new Error('Failed to retrieve session history.', { cause: error });
  }
}

export async function getDashboardData() {
  try {
    const allSessions = await db
      .select()
      .from(sessions)
      .orderBy(desc(sessions.createdAt))
      .limit(200);

    const allUsers = await db
      .select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        department: users.department,
        roleSlug: users.roleSlug,
        isOnline: users.isOnline,
        isActive: users.isActive,
        lastSeenAt: users.lastSeenAt,
      })
      .from(users);

    const userMap = new Map(allUsers.map((u) => [u.id, u]));

    const totalSessions = allSessions.length;
    const activeSessions = allSessions.filter((s) => s.status === 'active').length;
    const completedSessions = allSessions.filter((s) => s.status === 'ended').length;
    const pendingRequests = allSessions.filter(
      (s) => s.status === 'pending_approval' || s.status === 'waiting'
    ).length;

    const onlineTechnicians = allUsers.filter(
      (u) =>
        (u.roleSlug === 'technician' || u.roleSlug === 'admin') &&
        u.isOnline &&
        u.isActive
    );

    const recentActivities = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(25);

    const sessionsList = allSessions.slice(0, 50).map((s) => {
      const { accessTokenHash: _redacted, ...safe } = s;
      return {
        ...safe,
        host: userMap.get(s.hostUserId) ?? null,
        technician: s.technicianUserId
          ? userMap.get(s.technicianUserId) ?? null
          : null,
      };
    });

    return {
      metrics: {
        totalSessions,
        activeSessions,
        completedSessions,
        pendingRequests,
        onlineTechniciansCount: onlineTechnicians.length,
      },
      onlineTechnicians,
      technicians: allUsers.filter(
        (u) => u.roleSlug === 'technician' || u.roleSlug === 'admin'
      ),
      employees: allUsers,
      sessions: sessionsList,
      recentActivities,
    };
  } catch (error) {
    console.error('Database query failed in getDashboardData:', error);
    throw new Error('Failed to load IT Support dashboard.', { cause: error });
  }
}

export async function listAllUsers(search?: string) {
  try {
    const rows = await db
      .select()
      .from(users)
      .where(
        search && search.trim()
          ? or(
              ilike(users.email, `%${search.trim()}%`),
              ilike(users.displayName, `%${search.trim()}%`),
              ilike(users.department, `%${search.trim()}%`)
            )
          : undefined
      )
      .orderBy(desc(users.createdAt));
    return rows;
  } catch (error) {
    console.error('Database query failed in listAllUsers:', error);
    throw new Error('Failed to load corporate user directory.', {
      cause: error,
    });
  }
}

export async function getAuditLogEntries(limitCount = 100) {
  try {
    return await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(limitCount);
  } catch (error) {
    console.error('Database query failed in getAuditLogEntries:', error);
    throw new Error('Failed to retrieve audit logs.', { cause: error });
  }
}
