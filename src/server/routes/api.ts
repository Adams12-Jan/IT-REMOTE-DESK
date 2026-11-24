import crypto from 'crypto';
import express, { type Response } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { and, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../db/index.ts';
import {
  fileTransfers,
  sessionMessages,
  sessionParticipants,
  sessionPermissions,
  sessions,
  users,
} from '../../db/schema.ts';
import {
  createRemoteSession,
  findSessionByIdOrCode,
  getAppSettings,
  getAuditLogEntries,
  getDashboardData,
  getHydratedSession,
  getOrCreatePrimaryDevice,
  listAllUsers,
  listSessionHistory,
  recordAuditLog,
  setUserOnlineState,
  updateAppSettings,
} from '../db/queries.ts';
import { type AuthRequest, requireAuth, requireRole } from '../middleware/auth.ts';
import {
  generateAccessToken,
  generateIceServers,
  generateSessionCode,
  hashAccessToken,
  sanitizeFilename,
  scanUploadedFileBuffer,
  verifyAccessToken,
} from '../security.ts';
import { getIO } from '../signaling/socket.ts';

const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads', 'session-files');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // Hard ceiling; app_settings enforces configured limit
  },
});

const joinRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many session join attempts. Please wait a minute before trying again.',
  },
});

const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 180,
  standardHeaders: true,
  legacyHeaders: false,
});

const createSessionSchema = z.object({
  issueSummary: z.string().trim().min(2).max(160).optional(),
});

const joinSessionSchema = z.object({
  sessionCode: z
    .string()
    .transform((v) => v.replace(/\s+/g, ''))
    .refine((v) => /^\d{9,12}$/.test(v), 'Session ID must be 9 to 12 digits.'),
  accessToken: z
    .string()
    .trim()
    .min(4, 'Access code is required.')
    .max(16),
});

const approveSessionSchema = z.object({
  profileName: z.enum(['Default', 'View Only', 'Full Support']).default('Default'),
  canViewScreen: z.boolean().default(true),
  canControlInput: z.boolean().default(false),
  canShareClipboard: z.boolean().default(false),
  canTransferFiles: z.boolean().default(false),
  canRecordSession: z.boolean().default(false),
});

const updatePermissionsSchema = z.object({
  profileName: z.enum(['Default', 'View Only', 'Full Support', 'Custom']).optional(),
  canViewScreen: z.boolean().optional(),
  canControlInput: z.boolean().optional(),
  canShareClipboard: z.boolean().optional(),
  canTransferFiles: z.boolean().optional(),
  canRecordSession: z.boolean().optional(),
  emergencyStop: z.boolean().optional(),
});

const createMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

const updateUserSchema = z.object({
  roleSlug: z.enum(['admin', 'technician', 'employee']).optional(),
  department: z.string().trim().min(2).max(80).optional(),
  displayName: z.string().trim().min(2).max(80).optional(),
  isActive: z.boolean().optional(),
});

const createUserSchema = z.object({
  email: z.string().trim().email().toLowerCase(),
  displayName: z.string().trim().min(2).max(80),
  department: z.string().trim().min(2).max(80).default('Corporate Operations'),
  roleSlug: z.enum(['admin', 'technician', 'employee']).default('employee'),
});

const updateSettingsSchema = z.object({
  sessionExpiryMinutes: z.number().int().min(5).max(480).optional(),
  maxFailedAttempts: z.number().int().min(2).max(20).optional(),
  maxFileSizeMb: z.number().int().min(1).max(50).optional(),
  requireExplicitControlConsent: z.boolean().optional(),
  allowSessionRecording: z.boolean().optional(),
  enforceVetivaDomainOnly: z.boolean().optional(),
  allowedFileExtensions: z.array(z.string().trim().min(2).max(12)).optional(),
});

function canAccessSession(
  session: { hostUserId: number; technicianUserId: number | null },
  user: { id: number; roleSlug: string }
) {
  return (
    session.hostUserId === user.id ||
    session.technicianUserId === user.id ||
    user.roleSlug === 'admin'
  );
}

export function createApiRouter() {
  const router = express.Router();
  router.use(generalApiLimiter);

  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vetiva-it-remote-desk' });
  });

  // ---------------------------------------------------------------------------
  // Authentication Endpoints
  // ---------------------------------------------------------------------------
  router.post('/auth/login', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      await setUserOnlineState(user.id, true);
      const device = await getOrCreatePrimaryDevice(
        user.id,
        user.displayName,
        req.headers['user-agent']
      );

      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'auth.login',
        severity: 'info',
        ipAddress: req.ip,
        metadata: { role: user.roleSlug },
      });

      res.json({
        user,
        device,
        iceServers: generateIceServers(user.uid),
      });
    } catch (error) {
      console.error('Error in POST /api/auth/login:', error);
      res.status(500).json({ error: 'Unable to complete corporate sign-in.' });
    }
  });

  router.post('/auth/logout', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      await setUserOnlineState(user.id, false);
      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        action: 'auth.logout',
        severity: 'info',
        ipAddress: req.ip,
      });
      res.json({ success: true });
    } catch (error) {
      console.error('Error in POST /api/auth/logout:', error);
      res.status(500).json({ error: 'Failed to log out cleanly.' });
    }
  });

  router.get('/auth/me', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const device = await getOrCreatePrimaryDevice(
        user.id,
        user.displayName,
        req.headers['user-agent']
      );
      const settings = await getAppSettings();
      res.json({
        user,
        device,
        iceServers: generateIceServers(user.uid),
        securityPolicy: {
          sessionExpiryMinutes: settings.sessionExpiryMinutes,
          maxFileSizeMb: settings.maxFileSizeMb,
          allowSessionRecording: settings.allowSessionRecording,
          requireExplicitControlConsent: settings.requireExplicitControlConsent,
        },
      });
    } catch (error) {
      console.error('Error in GET /api/auth/me:', error);
      res.status(500).json({ error: 'Failed to load user profile.' });
    }
  });

  // ---------------------------------------------------------------------------
  // Remote Session Endpoints
  // ---------------------------------------------------------------------------
  router.post('/sessions/create', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const parsed = createSessionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid input.' });
      }

      const user = req.authUser!;
      const settings = await getAppSettings();
      const device = await getOrCreatePrimaryDevice(
        user.id,
        user.displayName,
        req.headers['user-agent']
      );

      // Expire any previous open waiting sessions hosted by this user
      await db
        .update(sessions)
        .set({
          status: 'ended',
          endedAt: new Date(),
          endReason: 'Replaced by new session',
          updatedAt: new Date(),
        })
        .where(and(eq(sessions.hostUserId, user.id), eq(sessions.status, 'waiting')));

      const sessionCode = generateSessionCode();
      const accessToken = generateAccessToken(6);
      const accessTokenHash = hashAccessToken(accessToken);
      const expiresAt = new Date(
        Date.now() + settings.sessionExpiryMinutes * 60 * 1000
      );

      const created = await createRemoteSession({
        sessionCode,
        accessTokenHash,
        hostUserId: user.id,
        deviceId: device.id,
        issueSummary: parsed.data.issueSummary || 'IT Desk Screen Share',
        expiresAt,
      });

      await recordAuditLog({
        actorUserId: user.id,
        actorEmail: user.email,
        sessionId: created.session.id,
        action: 'session.created',
        severity: 'info',
        ipAddress: req.ip,
        metadata: { sessionCode },
      });

      const hydrated = await getHydratedSession(created.session.id);

      // Return single-use plaintext accessToken strictly once upon creation
      res.status(201).json({
        session: hydrated,
        accessToken,
      });
    } catch (error) {
      console.error('Error in POST /api/sessions/create:', error);
      res.status(500).json({ error: 'Failed to create screen sharing session.' });
    }
  });

  router.post(
    '/sessions/join',
    requireAuth,
    joinRateLimiter,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = joinSessionSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: parsed.error.issues[0]?.message || 'Invalid session code.' });
        }

        const user = req.authUser!;
        const settings = await getAppSettings();
        const session = await findSessionByIdOrCode(parsed.data.sessionCode);

        if (!session) {
          await recordAuditLog({
            actorUserId: user.id,
            actorEmail: user.email,
            action: 'session.join.not_found',
            severity: 'warning',
            ipAddress: req.ip,
            metadata: { sessionCode: parsed.data.sessionCode },
          });
          return res.status(404).json({
            error: 'No active desk session matched that Session ID.',
          });
        }

        if (session.hostUserId === user.id) {
          return res.status(400).json({
            error: 'You cannot join your own shared desk as the remote technician.',
          });
        }

        if (session.status === 'ended' || session.status === 'expired' || session.status === 'rejected') {
          return res.status(410).json({
            error: `This session has already ${session.status}. Ask the user to start a new session.`,
          });
        }

        if (new Date() > new Date(session.expiresAt)) {
          await db
            .update(sessions)
            .set({ status: 'expired', updatedAt: new Date() })
            .where(eq(sessions.id, session.id));
          return res.status(410).json({
            error: 'This session code has expired. Please request a fresh session ID.',
          });
        }

        if (session.isLocked || session.failedJoinAttempts >= settings.maxFailedAttempts) {
          return res.status(423).json({
            error: 'Session locked after too many invalid access code attempts.',
          });
        }

        const isMatch = verifyAccessToken(
          parsed.data.accessToken,
          session.accessTokenHash
        );

        if (!isMatch) {
          const nextAttempts = session.failedJoinAttempts + 1;
          const shouldLock = nextAttempts >= settings.maxFailedAttempts;
          await db
            .update(sessions)
            .set({
              failedJoinAttempts: nextAttempts,
              isLocked: shouldLock,
              updatedAt: new Date(),
            })
            .where(eq(sessions.id, session.id));

          await recordAuditLog({
            actorUserId: user.id,
            actorEmail: user.email,
            sessionId: session.id,
            action: shouldLock ? 'session.locked_bruteforce' : 'session.join.invalid_code',
            severity: shouldLock ? 'critical' : 'warning',
            ipAddress: req.ip,
            metadata: { attempt: nextAttempts },
          });

          return res.status(401).json({
            error: shouldLock
              ? 'Session has been locked due to repeated invalid access codes.'
              : `Invalid access code. ${settings.maxFailedAttempts - nextAttempts} attempt(s) remaining.`,
          });
        }

        // Valid session & access code -> move to pending_approval and notify host
        await db
          .update(sessions)
          .set({
            technicianUserId: user.id,
            status: session.status === 'active' ? 'active' : 'pending_approval',
            failedJoinAttempts: 0,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, session.id));

        await db
          .insert(sessionParticipants)
          .values({
            sessionId: session.id,
            userId: user.id,
            participantRole: 'technician',
            connectionState: 'pending',
          })
          .onConflictDoUpdate({
            target: [sessionParticipants.sessionId, sessionParticipants.userId],
            set: { connectionState: 'pending', leftAt: null },
          });

        const [sysMsg] = await db
          .insert(sessionMessages)
          .values({
            sessionId: session.id,
            senderUserId: null,
            senderName: 'Vetiva Security',
            messageType: 'system',
            body: `Session request received from ${user.displayName} (${user.email}).`,
          })
          .returning();

        await recordAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          sessionId: session.id,
          action: 'session.join_requested',
          severity: 'info',
          ipAddress: req.ip,
        });

        const hydrated = await getHydratedSession(session.id);

        const io = getIO();
        if (io) {
          io.to(`user:${session.hostUserId}`)
            .to(`session:${session.id}`)
            .emit('session:incoming-request', {
              sessionId: session.id,
              sessionCode: session.sessionCode,
              requester: {
                id: user.id,
                displayName: user.displayName,
                email: user.email,
                roleSlug: user.roleSlug,
                department: user.department,
              },
              systemMessage: sysMsg,
            });
        }

        res.json({ session: hydrated });
      } catch (error) {
        console.error('Error in POST /api/sessions/join:', error);
        res.status(500).json({ error: 'Unable to join remote support session.' });
      }
    }
  );

  router.get('/sessions/history', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const user = req.authUser!;
      const history = await listSessionHistory({
        userId: user.id,
        roleSlug: user.roleSlug,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        dateFrom: typeof req.query.dateFrom === 'string' ? req.query.dateFrom : undefined,
        dateTo: typeof req.query.dateTo === 'string' ? req.query.dateTo : undefined,
        technicianId:
          typeof req.query.technicianId === 'string' && req.query.technicianId
            ? Number(req.query.technicianId)
            : undefined,
      });
      res.json({ sessions: history });
    } catch (error) {
      console.error('Error in GET /api/sessions/history:', error);
      res.status(500).json({ error: 'Failed to load session history.' });
    }
  });

  router.get('/sessions/:id', requireAuth, async (req: AuthRequest, res: Response) => {
    try {
      const session = await findSessionByIdOrCode(req.params.id);
      if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
      }
      if (!canAccessSession(session, req.authUser!)) {
        return res.status(403).json({ error: 'Access denied to this session.' });
      }
      const hydrated = await getHydratedSession(session.id);
      res.json({ session: hydrated });
    } catch (error) {
      console.error('Error in GET /api/sessions/:id:', error);
      res.status(500).json({ error: 'Failed to fetch session details.' });
    }
  });

  router.post(
    '/sessions/:id/approve',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = approveSessionSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid permission settings.' });
        }

        const session = await findSessionByIdOrCode(req.params.id);
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }

        const user = req.authUser!;
        if (session.hostUserId !== user.id && user.roleSlug !== 'admin') {
          return res.status(403).json({
            error: 'Only the host employee can approve an incoming connection.',
          });
        }

        const settings = await getAppSettings();
        const canRecord =
          settings.allowSessionRecording && parsed.data.canRecordSession;

        await db
          .update(sessions)
          .set({
            status: 'active',
            startedAt: session.startedAt ?? new Date(),
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, session.id));

        await db
          .update(sessionPermissions)
          .set({
            profileName: parsed.data.profileName,
            canViewScreen: parsed.data.canViewScreen,
            canControlInput: parsed.data.canControlInput,
            canShareClipboard: parsed.data.canShareClipboard,
            canTransferFiles: parsed.data.canTransferFiles,
            canRecordSession: canRecord,
            unattendedAccess: false,
            updatedByUserId: user.id,
            updatedAt: new Date(),
          })
          .where(eq(sessionPermissions.sessionId, session.id));

        if (session.technicianUserId) {
          await db
            .update(sessionParticipants)
            .set({ connectionState: 'connected' })
            .where(
              and(
                eq(sessionParticipants.sessionId, session.id),
                eq(sessionParticipants.userId, session.technicianUserId)
              )
            );
        }

        await db.insert(sessionMessages).values({
          sessionId: session.id,
          senderUserId: null,
          senderName: 'Vetiva Security',
          messageType: 'system',
          body: `${user.displayName} approved connection (${parsed.data.profileName} profile).`,
        });

        await recordAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          sessionId: session.id,
          action: 'session.approved',
          severity: 'info',
          ipAddress: req.ip,
          metadata: parsed.data,
        });

        const hydrated = await getHydratedSession(session.id);

        const io = getIO();
        if (io) {
          io.to(`session:${session.id}`).emit('session:approved', {
            sessionId: session.id,
            session: hydrated,
          });
          if (session.technicianUserId) {
            io.to(`user:${session.technicianUserId}`).emit('session:approved', {
              sessionId: session.id,
              session: hydrated,
            });
          }
        }

        res.json({ session: hydrated });
      } catch (error) {
        console.error('Error in POST /api/sessions/:id/approve:', error);
        res.status(500).json({ error: 'Failed to approve incoming connection.' });
      }
    }
  );

  router.post(
    '/sessions/:id/reject',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const session = await findSessionByIdOrCode(req.params.id);
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }

        const user = req.authUser!;
        if (session.hostUserId !== user.id && user.roleSlug !== 'admin') {
          return res.status(403).json({
            error: 'Only the host employee can dismiss an incoming connection.',
          });
        }

        const rejectedTechId = session.technicianUserId;

        await db
          .update(sessions)
          .set({
            status: 'waiting',
            technicianUserId: null,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, session.id));

        await db.insert(sessionMessages).values({
          sessionId: session.id,
          senderUserId: null,
          senderName: 'Vetiva Security',
          messageType: 'system',
          body: `${user.displayName} dismissed the incoming connection request.`,
        });

        await recordAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          sessionId: session.id,
          action: 'session.rejected',
          severity: 'warning',
          ipAddress: req.ip,
          metadata: { rejectedTechnicianId: rejectedTechId },
        });

        const hydrated = await getHydratedSession(session.id);
        const io = getIO();
        if (io) {
          io.to(`session:${session.id}`).emit('session:rejected', {
            sessionId: session.id,
          });
          if (rejectedTechId) {
            io.to(`user:${rejectedTechId}`).emit('session:rejected', {
              sessionId: session.id,
            });
          }
        }

        res.json({ session: hydrated });
      } catch (error) {
        console.error('Error in POST /api/sessions/:id/reject:', error);
        res.status(500).json({ error: 'Failed to dismiss connection request.' });
      }
    }
  );

  router.post(
    '/sessions/:id/disconnect',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const session = await findSessionByIdOrCode(req.params.id);
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }

        const user = req.authUser!;
        if (!canAccessSession(session, user)) {
          return res.status(403).json({ error: 'Unauthorized to disconnect session.' });
        }

        const reason =
          typeof req.body?.reason === 'string' && req.body.reason.trim()
            ? req.body.reason.trim().slice(0, 120)
            : `Terminated by ${user.displayName}`;

        await db
          .update(sessions)
          .set({
            status: 'ended',
            endedAt: new Date(),
            endedByUserId: user.id,
            endReason: reason,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, session.id));

        await db
          .update(sessionPermissions)
          .set({
            canControlInput: false,
            canShareClipboard: false,
            canTransferFiles: false,
            canRecordSession: false,
            updatedByUserId: user.id,
            updatedAt: new Date(),
          })
          .where(eq(sessionPermissions.sessionId, session.id));

        await db
          .update(sessionParticipants)
          .set({ connectionState: 'disconnected', leftAt: new Date() })
          .where(eq(sessionParticipants.sessionId, session.id));

        await db.insert(sessionMessages).values({
          sessionId: session.id,
          senderUserId: null,
          senderName: 'Vetiva Security',
          messageType: 'system',
          body: `Session ended (${reason}).`,
        });

        await recordAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          sessionId: session.id,
          action: 'session.disconnected',
          severity: 'info',
          ipAddress: req.ip,
          metadata: { reason },
        });

        const hydrated = await getHydratedSession(session.id);

        const io = getIO();
        if (io) {
          io.to(`session:${session.id}`).emit('session:disconnected', {
            sessionId: session.id,
            reason,
            endedBy: user.displayName,
          });
          if (session.hostUserId) {
            io.to(`user:${session.hostUserId}`).emit('session:disconnected', {
              sessionId: session.id,
              reason,
            });
          }
          if (session.technicianUserId) {
            io.to(`user:${session.technicianUserId}`).emit('session:disconnected', {
              sessionId: session.id,
              reason,
            });
          }
        }

        res.json({ session: hydrated });
      } catch (error) {
        console.error('Error in POST /api/sessions/:id/disconnect:', error);
        res.status(500).json({ error: 'Failed to terminate remote session.' });
      }
    }
  );

  router.post(
    '/sessions/:id/permissions',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = updatePermissionsSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid permission payload.' });
        }

        const session = await findSessionByIdOrCode(req.params.id);
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }

        const user = req.authUser!;
        const isHostOrAdmin =
          session.hostUserId === user.id || user.roleSlug === 'admin';
        const isEmergencyStopOnly =
          parsed.data.emergencyStop === true &&
          canAccessSession(session, user);

        if (!isHostOrAdmin && !isEmergencyStopOnly) {
          return res.status(403).json({
            error: 'Only the host employee can grant or modify remote permissions.',
          });
        }

        const [existing] = await db
          .select()
          .from(sessionPermissions)
          .where(eq(sessionPermissions.sessionId, session.id))
          .limit(1);

        const settings = await getAppSettings();

        const nextValues = parsed.data.emergencyStop
          ? {
              profileName: 'View Only',
              canViewScreen: existing?.canViewScreen ?? true,
              canControlInput: false,
              canShareClipboard: false,
              canTransferFiles: false,
              canRecordSession: false,
              unattendedAccess: false,
              emergencyStoppedAt: new Date(),
              updatedByUserId: user.id,
              updatedAt: new Date(),
            }
          : {
              profileName: parsed.data.profileName ?? existing?.profileName ?? 'Custom',
              canViewScreen: parsed.data.canViewScreen ?? existing?.canViewScreen ?? true,
              canControlInput:
                parsed.data.canControlInput ?? existing?.canControlInput ?? false,
              canShareClipboard:
                parsed.data.canShareClipboard ?? existing?.canShareClipboard ?? false,
              canTransferFiles:
                parsed.data.canTransferFiles ?? existing?.canTransferFiles ?? false,
              canRecordSession: settings.allowSessionRecording
                ? (parsed.data.canRecordSession ?? existing?.canRecordSession ?? false)
                : false,
              unattendedAccess: false,
              updatedByUserId: user.id,
              updatedAt: new Date(),
            };

        const [updated] = await db
          .update(sessionPermissions)
          .set(nextValues)
          .where(eq(sessionPermissions.sessionId, session.id))
          .returning();

        await db.insert(sessionMessages).values({
          sessionId: session.id,
          senderUserId: null,
          senderName: 'Vetiva Security',
          messageType: 'system',
          body: parsed.data.emergencyStop
            ? `EMERGENCY STOP activated by ${user.displayName}. All remote input, clipboard, file transfer, and recording revoked.`
            : `${user.displayName} updated permissions (Control: ${updated.canControlInput ? 'On' : 'Off'}, Clipboard: ${updated.canShareClipboard ? 'On' : 'Off'}, Files: ${updated.canTransferFiles ? 'On' : 'Off'}).`,
        });

        await recordAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          sessionId: session.id,
          action: parsed.data.emergencyStop
            ? 'session.emergency_stop'
            : 'session.permissions_updated',
          severity: parsed.data.emergencyStop ? 'critical' : 'info',
          ipAddress: req.ip,
          metadata: updated,
        });

        const io = getIO();
        if (io) {
          io.to(`session:${session.id}`).emit('session:permissions-updated', {
            sessionId: session.id,
            permissions: updated,
            emergencyStop: Boolean(parsed.data.emergencyStop),
          });
        }

        res.json({ permissions: updated });
      } catch (error) {
        console.error('Error in POST /api/sessions/:id/permissions:', error);
        res.status(500).json({ error: 'Failed to update session permissions.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Chat Endpoints
  // ---------------------------------------------------------------------------
  router.get(
    '/sessions/:id/messages',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const session = await findSessionByIdOrCode(req.params.id);
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }
        if (!canAccessSession(session, req.authUser!)) {
          return res.status(403).json({ error: 'Access denied.' });
        }
        const msgs = await db
          .select()
          .from(sessionMessages)
          .where(eq(sessionMessages.sessionId, session.id))
          .orderBy(sessionMessages.createdAt);
        res.json({ messages: msgs });
      } catch (error) {
        console.error('Error in GET /api/sessions/:id/messages:', error);
        res.status(500).json({ error: 'Failed to load chat history.' });
      }
    }
  );

  router.post(
    '/sessions/:id/messages',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = createMessageSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Message cannot be empty.' });
        }

        const session = await findSessionByIdOrCode(req.params.id);
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }

        const user = req.authUser!;
        if (!canAccessSession(session, user)) {
          return res.status(403).json({ error: 'Access denied.' });
        }

        const [msg] = await db
          .insert(sessionMessages)
          .values({
            sessionId: session.id,
            senderUserId: user.id,
            senderName: user.displayName,
            messageType: 'text',
            body: parsed.data.body,
          })
          .returning();

        const io = getIO();
        if (io) {
          io.to(`session:${session.id}`).emit('session:message', {
            sessionId: session.id,
            message: msg,
          });
        }

        res.status(201).json({ message: msg });
      } catch (error) {
        console.error('Error in POST /api/sessions/:id/messages:', error);
        res.status(500).json({ error: 'Failed to send message.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // File Transfer Endpoints (Explicit Consent + Validation + Confinement)
  // ---------------------------------------------------------------------------
  router.post(
    '/files/upload',
    requireAuth,
    upload.single('file'),
    async (req: AuthRequest, res: Response) => {
      try {
        const sessionIdRaw = req.body?.sessionId;
        if (!sessionIdRaw) {
          return res.status(400).json({ error: 'sessionId is required.' });
        }
        const session = await findSessionByIdOrCode(String(sessionIdRaw));
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }

        const user = req.authUser!;
        if (!canAccessSession(session, user)) {
          return res.status(403).json({ error: 'Access denied.' });
        }

        const [perms] = await db
          .select()
          .from(sessionPermissions)
          .where(eq(sessionPermissions.sessionId, session.id))
          .limit(1);

        if (!perms?.canTransferFiles) {
          return res.status(403).json({
            error:
              'File transfer permission is currently disabled. The host must enable File Transfer first.',
          });
        }

        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: 'No file attached.' });
        }

        const settings = await getAppSettings();
        const maxBytes = settings.maxFileSizeMb * 1024 * 1024;
        if (file.size > maxBytes) {
          return res.status(413).json({
            error: `File exceeds Vetiva's ${settings.maxFileSizeMb} MB transfer limit.`,
          });
        }

        const safeOriginal = sanitizeFilename(file.originalname);
        const scanResult = scanUploadedFileBuffer(
          safeOriginal,
          file.buffer,
          settings.allowedFileExtensions
        );

        if (!scanResult.safe) {
          await recordAuditLog({
            actorUserId: user.id,
            actorEmail: user.email,
            sessionId: session.id,
            action: 'file.upload.blocked',
            severity: 'critical',
            ipAddress: req.ip,
            metadata: { filename: safeOriginal, reason: scanResult.reason },
          });
          return res.status(400).json({ error: scanResult.reason });
        }

        const ext = path.extname(safeOriginal).toLowerCase();
        const storedName = `${crypto.randomUUID()}${ext}`;
        const destPath = path.resolve(UPLOAD_DIR, storedName);
        if (!destPath.startsWith(UPLOAD_DIR + path.sep)) {
          return res.status(400).json({ error: 'Invalid upload destination.' });
        }

        await fs.promises.writeFile(destPath, file.buffer);

        const [record] = await db
          .insert(fileTransfers)
          .values({
            sessionId: session.id,
            uploaderUserId: user.id,
            originalName: safeOriginal,
            storedName,
            mimeType: file.mimetype || 'application/octet-stream',
            sizeBytes: file.size,
            sha256Hash: scanResult.sha256,
            scanStatus: 'clean',
          })
          .returning();

        await recordAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          sessionId: session.id,
          action: 'file.uploaded',
          severity: 'info',
          ipAddress: req.ip,
          metadata: {
            fileId: record.id,
            filename: safeOriginal,
            sizeBytes: file.size,
          },
        });

        const { storedName: _omit, ...safeRecord } = record;

        const io = getIO();
        if (io) {
          io.to(`session:${session.id}`).emit('session:file-uploaded', {
            sessionId: session.id,
            file: safeRecord,
            uploaderName: user.displayName,
          });
        }

        res.status(201).json({ file: safeRecord });
      } catch (error) {
        console.error('Error in POST /api/files/upload:', error);
        res.status(500).json({ error: 'Failed to transfer file.' });
      }
    }
  );

  router.get(
    '/files/:id/download',
    requireAuth,
    async (req: AuthRequest, res: Response) => {
      try {
        const fileId = Number(req.params.id);
        if (Number.isNaN(fileId)) {
          return res.status(400).json({ error: 'Invalid file ID.' });
        }

        const [record] = await db
          .select()
          .from(fileTransfers)
          .where(eq(fileTransfers.id, fileId))
          .limit(1);

        if (!record) {
          return res.status(404).json({ error: 'File record not found.' });
        }

        const session = await findSessionByIdOrCode(record.sessionId);
        if (!session || !canAccessSession(session, req.authUser!)) {
          return res.status(403).json({ error: 'Unauthorized to download file.' });
        }

        const resolvedPath = path.resolve(UPLOAD_DIR, path.basename(record.storedName));
        if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep)) {
          return res.status(403).json({ error: 'Invalid file path.' });
        }

        if (!fs.existsSync(resolvedPath)) {
          return res.status(404).json({ error: 'File is no longer stored on disk.' });
        }

        await db
          .update(fileTransfers)
          .set({ downloadCount: record.downloadCount + 1 })
          .where(eq(fileTransfers.id, record.id));

        await recordAuditLog({
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          sessionId: session.id,
          action: 'file.downloaded',
          severity: 'info',
          ipAddress: req.ip,
          metadata: { fileId: record.id, filename: record.originalName },
        });

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${sanitizeFilename(record.originalName)}"`
        );
        res.sendFile(resolvedPath);
      } catch (error) {
        console.error('Error in GET /api/files/:id/download:', error);
        res.status(500).json({ error: 'Failed to download file.' });
      }
    }
  );

  // ---------------------------------------------------------------------------
  // IT Support Dashboard, User Management, Audit Logs & Settings
  // ---------------------------------------------------------------------------
  router.get(
    '/dashboard',
    requireAuth,
    requireRole('admin', 'technician'),
    async (_req: AuthRequest, res: Response) => {
      try {
        const data = await getDashboardData();
        res.json(data);
      } catch (error) {
        console.error('Error in GET /api/dashboard:', error);
        res.status(500).json({ error: 'Failed to load IT Support dashboard.' });
      }
    }
  );

  router.get(
    '/users',
    requireAuth,
    requireRole('admin'),
    async (req: AuthRequest, res: Response) => {
      try {
        const search = typeof req.query.search === 'string' ? req.query.search : undefined;
        const list = await listAllUsers(search);
        res.json({ users: list });
      } catch (error) {
        console.error('Error in GET /api/users:', error);
        res.status(500).json({ error: 'Failed to load users.' });
      }
    }
  );

  router.post(
    '/users',
    requireAuth,
    requireRole('admin'),
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = createUserSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: parsed.error.issues[0]?.message || 'Invalid user payload.' });
        }

        const existing = await db
          .select()
          .from(users)
          .where(eq(users.email, parsed.data.email))
          .limit(1);

        if (existing.length > 0) {
          return res.status(409).json({
            error: 'A user with this corporate email already exists.',
          });
        }

        const [created] = await db
          .insert(users)
          .values({
            uid: `invited:${crypto.randomUUID()}`,
            email: parsed.data.email,
            displayName: parsed.data.displayName,
            department: parsed.data.department,
            roleSlug: parsed.data.roleSlug,
            isActive: true,
            isOnline: false,
          })
          .returning();

        await recordAuditLog({
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          action: 'admin.user_invited',
          severity: 'info',
          ipAddress: req.ip,
          metadata: { email: created.email, roleSlug: created.roleSlug },
        });

        res.status(201).json({ user: created });
      } catch (error) {
        console.error('Error in POST /api/users:', error);
        res.status(500).json({ error: 'Failed to create user.' });
      }
    }
  );

  router.patch(
    '/users/:id',
    requireAuth,
    requireRole('admin'),
    async (req: AuthRequest, res: Response) => {
      try {
        const targetId = Number(req.params.id);
        if (Number.isNaN(targetId)) {
          return res.status(400).json({ error: 'Invalid user ID.' });
        }

        const parsed = updateUserSchema.safeParse(req.body);
        if (!parsed.success) {
          return res.status(400).json({ error: 'Invalid user update payload.' });
        }

        if (
          targetId === req.authUser!.id &&
          (parsed.data.isActive === false ||
            (parsed.data.roleSlug && parsed.data.roleSlug !== 'admin'))
        ) {
          return res.status(400).json({
            error: 'You cannot deactivate or demote your own administrator account.',
          });
        }

        const [updated] = await db
          .update(users)
          .set({
            ...parsed.data,
            updatedAt: new Date(),
          })
          .where(eq(users.id, targetId))
          .returning();

        if (!updated) {
          return res.status(404).json({ error: 'User not found.' });
        }

        await recordAuditLog({
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          action: 'admin.user_updated',
          severity: 'warning',
          ipAddress: req.ip,
          metadata: { targetUserId: targetId, changes: parsed.data },
        });

        res.json({ user: updated });
      } catch (error) {
        console.error('Error in PATCH /api/users/:id:', error);
        res.status(500).json({ error: 'Failed to update user.' });
      }
    }
  );

  router.get(
    '/settings',
    requireAuth,
    requireRole('admin'),
    async (_req: AuthRequest, res: Response) => {
      try {
        const settings = await getAppSettings();
        res.json({ settings });
      } catch (error) {
        console.error('Error in GET /api/settings:', error);
        res.status(500).json({ error: 'Failed to load settings.' });
      }
    }
  );

  router.patch(
    '/settings',
    requireAuth,
    requireRole('admin'),
    async (req: AuthRequest, res: Response) => {
      try {
        const parsed = updateSettingsSchema.safeParse(req.body);
        if (!parsed.success) {
          return res
            .status(400)
            .json({ error: parsed.error.issues[0]?.message || 'Invalid settings.' });
        }

        const updated = await updateAppSettings(parsed.data, req.authUser!.id);

        await recordAuditLog({
          actorUserId: req.authUser!.id,
          actorEmail: req.authUser!.email,
          action: 'admin.settings_updated',
          severity: 'warning',
          ipAddress: req.ip,
          metadata: parsed.data,
        });

        res.json({ settings: updated });
      } catch (error) {
        console.error('Error in PATCH /api/settings:', error);
        res.status(500).json({ error: 'Failed to save security settings.' });
      }
    }
  );

  router.get(
    '/audit-logs',
    requireAuth,
    requireRole('admin'),
    async (_req: AuthRequest, res: Response) => {
      try {
        const logs = await getAuditLogEntries(150);
        res.json({ logs });
      } catch (error) {
        console.error('Error in GET /api/audit-logs:', error);
        res.status(500).json({ error: 'Failed to load audit logs.' });
      }
    }
  );

  return router;
}
