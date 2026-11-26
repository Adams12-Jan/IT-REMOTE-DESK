import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
} from 'firebase/auth';
import { io, Socket } from 'socket.io-client';
import { auth, googleAuthProvider } from '../lib/firebase';
import {
  notifyLogout,
  syncAuthenticatedProfile,
} from '../lib/remoteDeskApi';
import {
  DeviceRecord,
  IceServerConfig,
  UserProfile,
} from '../types/remoteDesk';

export type ConnectionReadyState =
  | 'ready'
  | 'connecting'
  | 'disconnected'
  | 'unauthenticated';

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  profile: UserProfile | null;
  device: DeviceRecord | null;
  iceServers: IceServerConfig[];
  socket: Socket | null;
  connectionState: ConnectionReadyState;
  loading: boolean;
  authError: string | null;
  signInWithGoogle: () => Promise<UserProfile | null>;
  signOut: () => Promise<void>;
  apiFetch: <T = unknown>(url: string, init?: RequestInit) => Promise<T>;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [device, setDevice] = useState<DeviceRecord | null>(null);
  const [iceServers, setIceServers] = useState<IceServerConfig[]>([
    { urls: 'stun:stun.l.google.com:19302' },
  ]);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionReadyState>('connecting');
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Token held strictly in JS memory — never written to localStorage/sessionStorage
  const tokenRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const getFreshToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      const current = auth.currentUser;
      if (!current) return null;
      const token = await current.getIdToken(forceRefresh);
      tokenRef.current = token;
      return token;
    },
    []
  );

  const apiFetch = useCallback(
    async <T = unknown>(url: string, init: RequestInit = {}): Promise<T> => {
      let token = tokenRef.current || (await getFreshToken(false));
      const headers = new Headers(init.headers || {});
      if (token) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      if (!(init.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
      }

      let res = await fetch(url, { ...init, headers });

      if (res.status === 401 && auth.currentUser) {
        token = await getFreshToken(true);
        if (token) {
          headers.set('Authorization', `Bearer ${token}`);
          res = await fetch(url, { ...init, headers });
        }
      }

      const contentType = res.headers.get('content-type') || '';
      const payload = contentType.includes('application/json')
        ? await res.json()
        : null;

      if (!res.ok) {
        throw new Error(
          payload?.error || `Request failed with status ${res.status}`
        );
      }
      return payload as T;
    },
    [getFreshToken]
  );

  const connectSocket = useCallback(
    async (token: string) => {
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }

      setConnectionState('connecting');
      const nextSocket = io({
        auth: { token },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1500,
      });

      nextSocket.on('connect', () => {
        setConnectionState('ready');
      });

      nextSocket.on('disconnect', () => {
        setConnectionState('disconnected');
      });

      nextSocket.on('connect_error', async () => {
        setConnectionState('disconnected');
        const refreshed = await getFreshToken(true).catch(() => null);
        if (refreshed) {
          nextSocket.auth = { token: refreshed };
        }
      });

      socketRef.current = nextSocket;
      setSocket(nextSocket);
    },
    [getFreshToken]
  );

  const syncUserSession = useCallback(
    async (user: FirebaseUser) => {
      try {
        setAuthError(null);
        const token = await user.getIdToken();
        tokenRef.current = token;

        const [{ user: userProfile, device: deviceRecord }, iceRes] =
          await Promise.all([
            syncAuthenticatedProfile(apiFetch),
            apiFetch<{ iceServers: IceServerConfig[] }>('/api/ice-servers').catch(
              () => ({
                iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
              })
            ),
          ]);

        setProfile(userProfile);
        setDevice(deviceRecord);
        if (iceRes.iceServers?.length) {
          setIceServers(iceRes.iceServers);
        }
        await connectSocket(token);
        return userProfile;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : 'Unable to authenticate session.';
        setAuthError(msg);
        setConnectionState('unauthenticated');
        return null;
      }
    },
    [apiFetch, connectSocket]
  );

  const refreshProfile = useCallback(async () => {
    if (!auth.currentUser) return;
    const { user, device: dev } = await syncAuthenticatedProfile(apiFetch);
    setProfile(user);
    setDevice(dev);
  }, [apiFetch]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await syncUserSession(user);
      } else {
        tokenRef.current = null;
        setProfile(null);
        setDevice(null);
        if (socketRef.current) {
          socketRef.current.disconnect();
          socketRef.current = null;
        }
        setSocket(null);
        setConnectionState('unauthenticated');
      }
      setLoading(false);
    });

    return () => {
      unsubscribe();
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
    };
  }, [syncUserSession]);

  const signInWithGoogle = useCallback(async (): Promise<UserProfile | null> => {
    setAuthError(null);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      return syncUserSession(cred.user);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to sign in with Google.';
      if (msg.includes('auth/unauthorized-domain')) {
        const host =
          typeof window !== 'undefined' ? window.location.hostname : '';
        const friendly = `Domain "${host}" is not authorized in Firebase Authentication. Add it under Authentication -> Settings -> Authorized domains in your Firebase Console.`;
        setAuthError(friendly);
        throw new Error(friendly);
      }
      throw err;
    }
  }, [syncUserSession]);

  const signOut = useCallback(async () => {
    try {
      await notifyLogout(apiFetch);
    } finally {
      tokenRef.current = null;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      setSocket(null);
      setProfile(null);
      setDevice(null);
      setConnectionState('unauthenticated');
      await firebaseSignOut(auth);
    }
  }, [apiFetch]);

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        device,
        iceServers,
        socket,
        connectionState,
        loading,
        authError,
        signInWithGoogle,
        signOut,
        apiFetch,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used inside AuthProvider');
  }
  return ctx;
}
