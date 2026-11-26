import crypto from 'crypto';
import express, { type Response } from 'express';
import rateLimit from 'express-rate-limit';
import fs from 'fs';
import multer from 'multer';
import path from 'path';
import { z } from 'zod';
import {
  addSessionMessageInDb,
  approveSessionInDb,
  canUserAccessSession,
  createInviteInDb,
  createSessionRecord,
  disconnectSessionInDb,
  expireSessionInDb,
  fetchAuditLogsForUser,
  fetchDashboardForUser,
  fetchHistoryForUser,
  getAppSettings,
  getFileRecordByStoredName,
  getSessionById,
  getSessionRow,
  incrementFileDownloadInDb,
  joinSessionInDb,
  listDirectoryInDb,
  markUserOffline,
  recordAuditLog,
  recordFileTransferInDb,
  recordSessionJoinFailure,
  rejectSessionInDb,
  revokeInviteInDb,
  syncAuthenticatedUserAndDevice,
  updateAppSettings,
  updatePermissionsInDb,
  updateTelemetryInDb,
  updateUserInDb,
} from '../db.ts';
import {
  type AuthRequest,
  requireAdmin,
  requireAuth,
  requireProfile,
} from '../middleware/auth.ts';
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
    fileSize: 50 * 1024 * 1024,
  },
});

const joinRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: 'Too many session join attempts. Please wait a minute before trying again.',
  },
});

const generalApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
});

const createSessionSchema = z.object({
  deviceId: z.string().min(1).max(128),
  issueSummary: z.string().max(160).optional(),
});

const joinSessionSchema = z.object({
  sessionCode: z
    .string()
    .transform((v) => v.replace(/\s+/g, ''))
    .refine((v) => /^\d{9,12}$/.test(v), 'Session ID must be 9 to 12 digits.'),
  accessToken: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .refine((v) => v.length >= 4 && v.length <= 16, 'Valid access code is required.'),
});

const approveSchema = z.object({
  profileName: z.enum(['Default', 'View Only', 'Full Support']),
  canViewScreen: z.boolean(),
  canControlInput: z.boolean(),
  canShareClipboard: z.boolean(),
  canTransferFiles: z.boolean(),
  canRecordSession: z.boolean(),
});

const permissionsSchema = z.object({
  profileName: z.enum(['Default', 'View Only', 'Full Support', 'Custom']).optional(),
  canViewScreen: z.boolean().optional(),
  canControlInput: z.boolean().optional(),
  canShareClipboard: z.boolean().optional(),
  canTransferFiles: z.boolean().optional(),
  canRecordSession: z.boolean().optional(),
  emergencyStop: z.boolean().optional(),
});

const createInviteSchema = z.object({
  email: z.string().email().max(200),
  displayName: z.string().min(1).max(100),
  department: z.string().max(100).optional(),
  roleSlug: z.enum(['admin', 'technician', 'employee']),
});

const updateUserSchema = z.object({
  roleSlug: z.enum(['admin', 'technician', 'employee']).optional(),
  isActive: z.boolean().optional(),
});

const updateSettingsSchema = z.object({
  sessionExpiryMinutes: z.number().min(5).max(480),
  maxFailedAttempts: z.number().min(2).max(20),
  maxFileSizeMb: z.number().min(1).max(50),
  requireExplicitControlConsent: z.boolean(),
  allowSessionRecording: z.boolean(),
  enforceVetivaDomainOnly: z.boolean(),
  allowedFileExtensions: z.array(z.string()).max(25),
});

function broadcastSessionUpdate(sessionId: string) {
  const io = getIO();
  const session = getSessionById(sessionId);
  if (!io || !session) return;
  io.to(`session:${sessionId}`).emit('session:updated', session);
  io.to(`user:${session.hostUid}`).emit('session:updated', session);
  if (session.technicianUid) {
    io.to(`user:${session.technicianUid}`).emit('session:updated', session);
  }
}

export function createApiRouter() {
  const router = express.Router();
  router.use(generalApiLimiter);

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'vetiva-virtual-remote-desk',
      persistence: 'sqlite',
    });
  });

  // Sync verified Google Workspace / Firebase Auth user and workstation device
  router.post('/auth/sync', requireAuth, (req: AuthRequest, res: Response) => {
    try {
      const authUser = req.authUser!;
      const result = syncAuthenticatedUserAndDevice({
        uid: authUser.uid,
        email: authUser.email,
        displayName: authUser.displayName,
        userAgent: String(req.headers['user-agent'] || ''),
      });
      getIO()?.to('ops:dashboard').emit('presence:technician-update');
      res.json(result);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : 'Unable to sync corporate account.';
      res.status(403).json({ error: msg });
    }
  });

  router.post('/auth/logout', requireAuth, (req: AuthRequest, res: Response) => {
    markUserOffline(req.authUser!.uid);
    getIO()?.to('ops:dashboard').emit('presence:technician-update');
    res.json({ ok: true });
  });

  // Short-lived TURN/STUN ICE servers
  router.get('/ice-servers', requireAuth, (req: AuthRequest, res: Response) => {
    res.json({
      iceServers: generateIceServers(req.authUser!.uid),
    });
  });

  // Create a new hosted support session
  router.post(
    '/sessions',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      const parsed = createSessionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid session request.',
        });
      }

      let sessionCode = generateSessionCode();
      while (getSessionRow(sessionCode)) {
        sessionCode = generateSessionCode();
      }

      const accessToken = generateAccessToken(6);
      const tokenHash = hashAccessToken(accessToken);

      try {
        const session = createSessionRecord({
          host: req.userProfile!,
          deviceId: parsed.data.deviceId,
          sessionCode,
          tokenHash,
          issueSummary: parsed.data.issueSummary || 'IT Desk Screen Share',
        });

        getIO()?.to('ops:dashboard').emit('session:incoming-request');
        res.status(201).json({ session, accessToken });
      } catch (error) {
        res.status(403).json({
          error:
            error instanceof Error
              ? error.message
              : 'Unable to initialize support session.',
        });
      }
    }
  );

  // Join an existing session with single-use access code & brute-force lockout protection
  router.post(
    '/sessions/join',
    requireAuth,
    requireProfile,
    joinRateLimiter,
    (req: AuthRequest, res: Response) => {
      const parsed = joinSessionSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid session credentials.',
        });
      }

      const { sessionCode, accessToken } = parsed.data;
      const technician = req.userProfile!;
      const settings = getAppSettings();
      const row = getSessionRow(sessionCode);

      if (!row) {
        return res.status(404).json({
          error: 'Invalid Session ID or single-use access code.',
        });
      }

      if (String(row.host_uid) === technician.uid) {
        return res.status(400).json({
          error: 'You cannot join your own hosted screen-sharing session.',
        });
      }

      if (row.locked_until && new Date(String(row.locked_until)) > new Date()) {
        return res.status(423).json({
          error: 'Session temporarily locked after too many invalid access code attempts.',
        });
      }

      if (!['waiting', 'pending_approval', 'active'].includes(String(row.status))) {
        return res.status(410).json({
          error: 'This support session has already ended or expired.',
        });
      }

      if (new Date() > new Date(String(row.expires_at))) {
        expireSessionInDb(String(row.id), technician);
        broadcastSessionUpdate(String(row.id));
        return res.status(410).json({
          error: 'This session code has expired. Please request a fresh session ID.',
        });
      }

      const valid = verifyAccessToken(accessToken, String(row.access_token_hash));
      if (!valid) {
        recordAuditLog({
          actorUid: technician.uid,
          actorEmail: technician.email,
          sessionId: String(row.id),
          action: 'session.join.rejected_or_invalid',
          severity: 'warning',
          metadata: { sessionCode },
        });
        const lockState = recordSessionJoinFailure(
          sessionCode,
          settings.maxFailedAttempts
        );
        return res.status(lockState.locked ? 423 : 401).json({
          error: lockState.locked
            ? 'Session has been locked for 15 minutes due to repeated invalid access codes.'
            : `Invalid Session ID or access code. ${lockState.attemptsRemaining} attempt(s) remaining.`,
        });
      }

      const session = joinSessionInDb({
        sessionId: String(row.id),
        technician,
      });

      broadcastSessionUpdate(session.id);
      getIO()?.to('ops:dashboard').emit('session:incoming-request');
      res.json({ session });
    }
  );

  router.get(
    '/sessions/:id',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      const session = getSessionById(String(req.params.id));
      if (!session) {
        return res.status(404).json({ error: 'Session not found.' });
      }
      if (!canUserAccessSession(session, req.userProfile!)) {
        return res.status(403).json({ error: 'Access denied for this session.' });
      }
      res.json({ session });
    }
  );

  router.post(
    '/sessions/:id/approve',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      const parsed = approveSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid permission profile.' });
      }
      try {
        const session = approveSessionInDb(
          String(req.params.id),
          req.userProfile!,
          parsed.data
        );
        broadcastSessionUpdate(session.id);
        getIO()?.to('ops:dashboard').emit('session:approved');
        res.json({ session });
      } catch (error) {
        res.status(403).json({
          error: error instanceof Error ? error.message : 'Unable to approve session.',
        });
      }
    }
  );

  router.post(
    '/sessions/:id/reject',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      try {
        const existing = getSessionById(String(req.params.id));
        const previousTechUid = existing?.technicianUid ?? null;
        const session = rejectSessionInDb(String(req.params.id), req.userProfile!);
        broadcastSessionUpdate(session.id);
        if (previousTechUid) {
          getIO()?.to(`user:${previousTechUid}`).emit('session:updated', session);
        }
        getIO()?.to('ops:dashboard').emit('session:disconnected');
        res.json({ session });
      } catch (error) {
        res.status(403).json({
          error: error instanceof Error ? error.message : 'Unable to dismiss request.',
        });
      }
    }
  );

  router.patch(
    '/sessions/:id/permissions',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      const parsed = permissionsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid permissions payload.' });
      }
      try {
        const session = updatePermissionsInDb(
          String(req.params.id),
          req.userProfile!,
          parsed.data
        );
        broadcastSessionUpdate(session.id);
        res.json({ session, permissions: session.permissions });
      } catch (error) {
        res.status(403).json({
          error: error instanceof Error ? error.message : 'Permission update denied.',
        });
      }
    }
  );

  router.post(
    '/sessions/:id/telemetry',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      const latencyMs = Number(req.body?.latencyMs ?? 0);
      updateTelemetryInDb(String(req.params.id), req.userProfile!.uid, latencyMs);
      res.json({ ok: true });
    }
  );

  router.post(
    '/sessions/:id/disconnect',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      try {
        const reason =
          typeof req.body?.reason === 'string' ? req.body.reason : undefined;
        const session = disconnectSessionInDb(
          String(req.params.id),
          req.userProfile!,
          reason
        );
        if (session) {
          broadcastSessionUpdate(session.id);
        }
        getIO()?.to('ops:dashboard').emit('session:disconnected');
        res.json({ session });
      } catch (error) {
        res.status(403).json({
          error: error instanceof Error ? error.message : 'Unable to disconnect session.',
        });
      }
    }
  );

  router.post(
    '/sessions/:id/messages',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      const body = typeof req.body?.body === 'string' ? req.body.body : '';
      try {
        const message = addSessionMessageInDb(
          String(req.params.id),
          req.userProfile!,
          body
        );
        getIO()?.to(`session:${message.sessionId}`).emit('session:message', message);
        res.status(201).json({ message });
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Unable to send message.',
        });
      }
    }
  );

  // Malware-scanned file upload endpoint (enforces session participation, consent & corporate policy)
  router.post(
    '/files/upload',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response, next) => {
      upload.single('file')(req, res, (err) => {
        if (err) {
          const isSizeErr =
            err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE';
          return res.status(isSizeErr ? 413 : 400).json({
            error: isSizeErr
              ? 'File exceeds the maximum 50 MB server upload limit.'
              : err instanceof Error
                ? err.message
                : 'Invalid file upload.',
          });
        }
        next();
      });
    },
    async (req: AuthRequest, res: Response) => {
      try {
        const sessionIdRaw = String(req.body?.sessionId ?? '').trim();
        if (!/^\d{9,12}$/.test(sessionIdRaw)) {
          return res.status(400).json({ error: 'Valid sessionId is required.' });
        }

        const session = getSessionById(sessionIdRaw);
        if (!session) {
          return res.status(404).json({ error: 'Session not found.' });
        }
        if (!canUserAccessSession(session, req.userProfile!)) {
          return res.status(403).json({ error: 'Not authorized for this session.' });
        }
        if (!session.permissions?.canTransferFiles) {
          return res.status(403).json({
            error: 'Host has not granted File Transfer permission for this session.',
          });
        }

        const file = req.file;
        if (!file) {
          return res.status(400).json({ error: 'No file attached.' });
        }

        const policy = getAppSettings();
        const maxBytes = policy.maxFileSizeMb * 1024 * 1024;
        if (file.size > maxBytes) {
          return res.status(413).json({
            error: `File exceeds Vetiva's ${policy.maxFileSizeMb} MB transfer limit.`,
          });
        }

        const safeOriginal = sanitizeFilename(file.originalname);
        const scanResult = scanUploadedFileBuffer(
          safeOriginal,
          file.buffer,
          policy.allowedFileExtensions
        );

        if (!scanResult.safe) {
          return res.status(400).json({ error: scanResult.reason });
        }

        const ext = path.extname(safeOriginal).toLowerCase();
        const storedName = `${crypto.randomUUID()}${ext}`;
        const destPath = path.resolve(UPLOAD_DIR, storedName);
        if (!destPath.startsWith(UPLOAD_DIR + path.sep)) {
          return res.status(400).json({ error: 'Invalid upload destination.' });
        }

        await fs.promises.writeFile(destPath, file.buffer);

        const record = recordFileTransferInDb(session.id, req.userProfile!, {
          originalName: safeOriginal,
          storedName,
          mimeType: file.mimetype || 'application/octet-stream',
          sizeBytes: file.size,
          sha256Hash: scanResult.sha256,
          scanStatus: 'clean',
        });

        getIO()?.to(`session:${session.id}`).emit('session:file', record);
        res.status(201).json({ file: record });
      } catch (error) {
        console.error('Error in POST /api/files/upload:', error);
        res.status(500).json({ error: 'Failed to transfer file.' });
      }
    }
  );

  // Confined authenticated file download endpoint with session authorization check
  router.get(
    '/files/:storedName/download',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      try {
        const storedName = path.basename(String(req.params.storedName || ''));
        if (
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z0-9]{1,12}$/i.test(
            storedName
          )
        ) {
          return res.status(400).json({ error: 'Invalid file identifier.' });
        }

        const fileRow = getFileRecordByStoredName(storedName);
        if (!fileRow) {
          return res.status(404).json({ error: 'File transfer record not found.' });
        }

        const session = getSessionById(String(fileRow.session_id));
        if (!session || !canUserAccessSession(session, req.userProfile!)) {
          return res.status(403).json({ error: 'Access denied for this file transfer.' });
        }

        const resolvedPath = path.resolve(UPLOAD_DIR, storedName);
        if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep)) {
          return res.status(403).json({ error: 'Invalid file path.' });
        }

        if (!fs.existsSync(resolvedPath)) {
          return res
            .status(404)
            .json({ error: 'File is no longer stored on disk.' });
        }

        incrementFileDownloadInDb(storedName, req.userProfile!);

        const downloadName = sanitizeFilename(
          typeof req.query.name === 'string' && req.query.name.trim()
            ? req.query.name
            : String(fileRow.original_name || storedName)
        );

        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${downloadName}"`
        );
        res.sendFile(resolvedPath);
      } catch (error) {
        console.error('Error in GET /api/files/:storedName/download:', error);
        res.status(500).json({ error: 'Failed to download file.' });
      }
    }
  );

  // Dashboard & History
  router.get(
    '/dashboard',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      const profile = req.userProfile!;
      if (profile.roleSlug !== 'admin' && profile.roleSlug !== 'technician') {
        return res.status(403).json({ error: 'IT Support privileges required.' });
      }
      res.json(fetchDashboardForUser(profile));
    }
  );

  router.get(
    '/history',
    requireAuth,
    requireProfile,
    (req: AuthRequest, res: Response) => {
      const status =
        typeof req.query.status === 'string' ? req.query.status : 'all';
      const search =
        typeof req.query.search === 'string' ? req.query.search : '';
      res.json({
        sessions: fetchHistoryForUser(req.userProfile!, { status, search }),
      });
    }
  );

  // Admin: Corporate Directory & Invites
  router.get(
    '/users',
    requireAuth,
    requireProfile,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const search =
        typeof req.query.search === 'string' ? req.query.search : undefined;
      res.json(listDirectoryInDb(search));
    }
  );

  router.post(
    '/invites',
    requireAuth,
    requireProfile,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const parsed = createInviteSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid invite details.',
        });
      }
      const invite = createInviteInDb(
        {
          email: parsed.data.email,
          displayName: parsed.data.displayName,
          department: parsed.data.department || 'Vetiva Operations',
          roleSlug: parsed.data.roleSlug,
        },
        req.userProfile!
      );
      res.status(201).json({ invite });
    }
  );

  router.delete(
    '/invites/:id',
    requireAuth,
    requireProfile,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      revokeInviteInDb(String(req.params.id));
      res.json({ ok: true });
    }
  );

  router.patch(
    '/users/:uid',
    requireAuth,
    requireProfile,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const parsed = updateUserSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({ error: 'Invalid user update.' });
      }
      try {
        const user = updateUserInDb(
          String(req.params.uid),
          parsed.data,
          req.userProfile!
        );
        getIO()?.to('ops:dashboard').emit('presence:technician-update');
        res.json({ user });
      } catch (error) {
        res.status(400).json({
          error: error instanceof Error ? error.message : 'Unable to update user.',
        });
      }
    }
  );

  // Admin: Security Settings & Audit Logs
  router.get(
    '/settings',
    requireAuth,
    requireProfile,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      res.json({
        settings: getAppSettings(),
        logs: fetchAuditLogsForUser(req.userProfile!, 150),
      });
    }
  );

  router.put(
    '/settings',
    requireAuth,
    requireProfile,
    requireAdmin,
    (req: AuthRequest, res: Response) => {
      const parsed = updateSettingsSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res.status(400).json({
          error: parsed.error.issues[0]?.message || 'Invalid settings policy.',
        });
      }
      const settings = updateAppSettings(parsed.data, req.userProfile!);
      res.json({ settings });
    }
  );

  return router;
}
