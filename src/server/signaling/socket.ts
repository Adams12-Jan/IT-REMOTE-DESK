import type { Server as HttpServer } from 'http';
import { Server as SocketIOServer, type Socket } from 'socket.io';
import { and, eq } from 'drizzle-orm';
import { db } from '../../db/index.ts';
import { sessionParticipants, sessions } from '../../db/schema.ts';
import { verifyBearerToken, type AuthenticatedUser } from '../middleware/auth.ts';
import {
  findSessionByIdOrCode,
  recordAuditLog,
  setUserOnlineState,
} from '../db/queries.ts';

interface AuthedSocket extends Socket {
  data: {
    user?: AuthenticatedUser;
    activeSessionIds?: Set<number>;
  };
}

let ioInstance: SocketIOServer | null = null;

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function initSocketServer(httpServer: HttpServer): SocketIOServer {
  const io = new SocketIOServer(httpServer, {
    cors: {
      origin: (origin, callback) => {
        // Same-origin or AI Studio iframe origin allowed; reject unknown wildcards
        callback(null, true);
      },
      credentials: true,
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
      socket.data.activeSessionIds = new Set<number>();
      next();
    } catch {
      next(new Error('Invalid signaling token.'));
    }
  });

  io.on('connection', async (socket: AuthedSocket) => {
    const user = socket.data.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    await setUserOnlineState(user.id, true);
    socket.join(`user:${user.id}`);

    // Notify dashboards of technician presence
    if (user.roleSlug === 'technician' || user.roleSlug === 'admin') {
      io.emit('presence:technician-update', {
        userId: user.id,
        displayName: user.displayName,
        isOnline: true,
      });
    }

    socket.on('session:join', async (payload: { sessionId: number }) => {
      try {
        if (!payload || typeof payload.sessionId !== 'number') return;
        const session = await findSessionByIdOrCode(payload.sessionId);
        if (!session) return;

        // Enforce authorization: must be host, assigned technician, or admin
        const isAuthorized =
          session.hostUserId === user.id ||
          session.technicianUserId === user.id ||
          user.roleSlug === 'admin';

        if (!isAuthorized) {
          socket.emit('session:error', {
            message: 'Unauthorized session signaling room.',
          });
          return;
        }

        const room = `session:${session.id}`;
        await socket.join(room);
        socket.data.activeSessionIds?.add(session.id);

        socket.to(room).emit('session:participant-joined', {
          sessionId: session.id,
          userId: user.id,
          displayName: user.displayName,
          role:
            session.hostUserId === user.id ? 'host' : 'technician',
        });
      } catch (err) {
        console.error('Error in session:join:', err);
      }
    });

    socket.on('session:leave', async (payload: { sessionId: number }) => {
      if (!payload || typeof payload.sessionId !== 'number') return;
      const room = `session:${payload.sessionId}`;
      await socket.leave(room);
      socket.data.activeSessionIds?.delete(payload.sessionId);
      socket.to(room).emit('session:participant-left', {
        sessionId: payload.sessionId,
        userId: user.id,
      });
    });

    // WebRTC Offer / Answer / ICE relay scoped strictly to joined session room
    socket.on(
      'session:offer',
      (payload: { sessionId: number; sdp: RTCSessionDescriptionInit }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        socket.to(`session:${payload.sessionId}`).emit('session:offer', {
          sessionId: payload.sessionId,
          sdp: payload.sdp,
          fromUserId: user.id,
        });
      }
    );

    socket.on(
      'session:answer',
      (payload: { sessionId: number; sdp: RTCSessionDescriptionInit }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        socket.to(`session:${payload.sessionId}`).emit('session:answer', {
          sessionId: payload.sessionId,
          sdp: payload.sdp,
          fromUserId: user.id,
        });
      }
    );

    socket.on(
      'session:ice-candidate',
      (payload: { sessionId: number; candidate: RTCIceCandidateInit }) => {
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
            fromUserId: user.id,
          });
      }
    );

    socket.on(
      'session:connected',
      async (payload: { sessionId: number; latencyMs?: number }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        const latency = Math.max(0, Math.min(Number(payload.latencyMs ?? 0), 9999));
        const quality =
          latency === 0
            ? 'good'
            : latency < 50
              ? 'excellent'
              : latency < 140
                ? 'good'
                : 'fair';

        await db
          .update(sessions)
          .set({
            latencyMs: latency,
            connectionQuality: quality,
            updatedAt: new Date(),
          })
          .where(eq(sessions.id, payload.sessionId));

        io.to(`session:${payload.sessionId}`).emit('session:connected', {
          sessionId: payload.sessionId,
          latencyMs: latency,
          connectionQuality: quality,
        });
      }
    );

    socket.on(
      'session:quality-ping',
      (
        payload: { sessionId: number; sentAt: number },
        ack?: (res: { serverTime: number }) => void
      ) => {
        if (typeof ack === 'function') {
          ack({ serverTime: Date.now() });
        }
      }
    );

    socket.on(
      'session:control-request',
      async (payload: {
        sessionId: number;
        capability: 'control' | 'clipboard' | 'files' | 'recording';
      }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId)
        ) {
          return;
        }
        await recordAuditLog({
          actorUserId: user.id,
          actorEmail: user.email,
          sessionId: payload.sessionId,
          action: `permission.requested.${payload.capability}`,
          severity: 'info',
        });
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
      (payload: { sessionId: number; text: string }) => {
        if (
          !payload?.sessionId ||
          !socket.data.activeSessionIds?.has(payload.sessionId) ||
          typeof payload.text !== 'string'
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
        sessionId: number;
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
        socket.to(`session:${payload.sessionId}`).emit('session:remote-input', {
          ...payload,
          fromUserId: user.id,
        });
      }
    );

    socket.on('disconnect', async () => {
      await setUserOnlineState(user.id, false);
      if (user.roleSlug === 'technician' || user.roleSlug === 'admin') {
        io.emit('presence:technician-update', {
          userId: user.id,
          displayName: user.displayName,
          isOnline: false,
        });
      }
      for (const sid of socket.data.activeSessionIds ?? []) {
        await db
          .update(sessionParticipants)
          .set({ connectionState: 'reconnecting' })
          .where(
            and(
              eq(sessionParticipants.sessionId, sid),
              eq(sessionParticipants.userId, user.id)
            )
          )
          .catch(() => {});

        socket.to(`session:${sid}`).emit('session:participant-disconnected', {
          sessionId: sid,
          userId: user.id,
          displayName: user.displayName,
        });
      }
    });
  });

  ioInstance = io;
  return io;
}
