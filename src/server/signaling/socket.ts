import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import {
  canUserAccessSession,
  getSessionById,
  getUserByUid,
  updateTelemetryInDb,
} from '../db.ts';
import { verifyBearerToken, type VerifiedTokenUser } from '../middleware/auth.ts';

interface AuthedSocket extends Socket {
  data: {
    user?: VerifiedTokenUser;
    activeSessionIds?: Set<string>;
  };
}

let ioInstance: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    allowRequest: (req, callback) => {
      const origin = req.headers.origin;
      if (!origin) {
        return callback(null, true);
      }
      try {
        const originHost = new URL(origin).host.toLowerCase();
        const forwardedHost = String(req.headers['x-forwarded-host'] || '')
          .split(',')[0]
          .trim()
          .toLowerCase();
        const host = String(req.headers.host || '').trim().toLowerCase();
        const appUrlHost = process.env.APP_URL
          ? new URL(process.env.APP_URL).host.toLowerCase()
          : '';
        if (
          originHost === forwardedHost ||
          originHost === host ||
          (appUrlHost && originHost === appUrlHost)
        ) {
          return callback(null, true);
        }
      } catch {
        // Reject malformed Origin header
      }
      return callback('Origin not allowed', false);
    },
    pingTimeout: 20000,
    pingInterval: 10000,
  });

  io.use(async (socket: AuthedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token || typeof token !== 'string') {
        return next(new Error('Authentication required for signaling.'));
      }
      const user = await verifyBearerToken(token);
      socket.data.user = user;
      socket.data.activeSessionIds = new Set<string>();
      next();
    } catch {
      next(new Error('Invalid signaling token.'));
    }
  });

  io.on('connection', (socket: AuthedSocket) => {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    socket.join(`user:${user.uid}`);
    const userProfile = getUserByUid(user.uid);
    if (
      userProfile &&
      userProfile.isActive &&
      (userProfile.roleSlug === 'admin' || userProfile.roleSlug === 'technician')
    ) {
      socket.join('ops:dashboard');
    }

    socket.on('session:join', async (payload: { sessionId: string }) => {
      try {
        if (
          !payload ||
          typeof payload.sessionId !== 'string' ||
          !/^\d{9,12}$/.test(payload.sessionId)
        ) {
          return;
        }

        const profile = getUserByUid(user.uid);
        const sess = getSessionById(payload.sessionId);
        if (!profile || !sess || !canUserAccessSession(sess, profile)) {
          return;
        }

        const room = `session:${payload.sessionId}`;
        await socket.join(room);
        socket.data.activeSessionIds?.add(payload.sessionId);

        socket.to(room).emit('session:participant-joined', {
          sessionId: payload.sessionId,
          userUid: user.uid,
          displayName: user.displayName,
        });
      } catch (err) {
        console.error('Error in session:join:', err);
      }
    });

    socket.on('session:leave', async (payload: { sessionId: string }) => {
      if (!payload || typeof payload.sessionId !== 'string') return;
      const room = `session:${payload.sessionId}`;
      await socket.leave(room);
      socket.data.activeSessionIds?.delete(payload.sessionId);
      socket.to(room).emit('session:participant-left', {
        sessionId: payload.sessionId,
        userUid: user.uid,
      });
    });

    // WebRTC Offer / Answer / ICE relay scoped strictly to joined session room
    socket.on(
      'session:offer',
      (payload: { sessionId: string; sdp: RTCSessionDescriptionInit }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        socket.to(`session:${payload.sessionId}`).emit('session:offer', {
          sessionId: payload.sessionId,
          sdp: payload.sdp,
          fromUid: user.uid,
        });
      }
    );

    socket.on(
      'session:answer',
      (payload: { sessionId: string; sdp: RTCSessionDescriptionInit }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        socket.to(`session:${payload.sessionId}`).emit('session:answer', {
          sessionId: payload.sessionId,
          sdp: payload.sdp,
          fromUid: user.uid,
        });
      }
    );

    socket.on(
      'session:ice-candidate',
      (payload: { sessionId: string; candidate: RTCIceCandidateInit }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        socket
          .to(`session:${payload.sessionId}`)
          .emit('session:ice-candidate', {
            sessionId: payload.sessionId,
            candidate: payload.candidate,
            fromUid: user.uid,
          });
      }
    );

    socket.on(
      'session:quality-ping',
      (
        _payload: { sessionId: string; sentAt: number },
        ack?: (res: { serverTime: number }) => void
      ) => {
        if (typeof ack === 'function') {
          ack({ serverTime: Date.now() });
        }
      }
    );

    socket.on(
      'session:connected',
      (payload: { sessionId: string; latencyMs?: number }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        const latency = Math.max(
          0,
          Math.min(Number(payload.latencyMs ?? 0), 9999)
        );
        const quality =
          latency === 0
            ? 'good'
            : latency < 50
              ? 'excellent'
              : latency < 140
                ? 'good'
                : 'fair';

        updateTelemetryInDb(payload.sessionId, user.uid, latency);

        io.to(`session:${payload.sessionId}`).emit('session:connected', {
          sessionId: payload.sessionId,
          latencyMs: latency,
          connectionQuality: quality,
        });
      }
    );

    socket.on(
      'session:control-request',
      (payload: {
        sessionId: string;
        capability: 'control' | 'clipboard' | 'files' | 'recording';
      }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        socket
          .to(`session:${payload.sessionId}`)
          .emit('session:control-request', {
            sessionId: payload.sessionId,
            capability: payload.capability,
            requesterName: user.displayName,
            requesterEmail: user.email,
          });
      }
    );

    socket.on(
      'session:clipboard-sync',
      (payload: { sessionId: string; text: string }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId) ||
          typeof payload.text !== 'string'
        ) {
          return;
        }
        const sess = getSessionById(payload.sessionId);
        if (
          !sess ||
          sess.status !== 'active' ||
          !sess.permissions?.canShareClipboard ||
          sess.permissions.emergencyStoppedAt
        ) {
          return;
        }
        socket.to(`session:${payload.sessionId}`).emit('session:clipboard-sync', {
          sessionId: payload.sessionId,
          text: payload.text.slice(0, 8192),
          senderName: user.displayName,
        });
      }
    );

    socket.on(
      'session:remote-input',
      (payload: {
        sessionId: string;
        eventType: 'mousemove' | 'mousedown' | 'mouseup' | 'keydown' | 'wheel';
        x?: number;
        y?: number;
        button?: number;
        key?: string;
        deltaY?: number;
      }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        const sess = getSessionById(payload.sessionId);
        if (
          !sess ||
          sess.status !== 'active' ||
          sess.technicianUid !== user.uid ||
          !sess.permissions?.canControlInput ||
          sess.permissions.emergencyStoppedAt
        ) {
          return;
        }
        socket.to(`session:${payload.sessionId}`).emit('session:remote-input', {
          ...payload,
          fromUid: user.uid,
        });
      }
    );

    socket.on('disconnect', () => {
      for (const sid of socket.data.activeSessionIds ?? []) {
        socket.to(`session:${sid}`).emit('session:participant-disconnected', {
          sessionId: sid,
          userUid: user.uid,
          displayName: user.displayName,
        });
      }
    });
  });

  ioInstance = io;
  return io;
}
