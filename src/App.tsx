import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ShieldCheck, X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RemoteInputEvent, useWebRTCSession } from './hooks/useWebRTCSession';
import {
  approveIncomingSession,
  createRemoteSession,
  disconnectSession,
  getSessionByIdApi,
  joinRemoteSession,
  rejectIncomingSession,
  updateSessionPermissions,
} from './lib/remoteDeskApi';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppPage, Header } from './components/Header';
import { IncomingApprovalDialog } from './components/IncomingApprovalDialog';
import { Button, Card } from './components/ui/primitives';
import { LandingPage } from './pages/LandingPage';
import { ShareDeskPage } from './pages/ShareDeskPage';
import { RemoteViewerPage } from './pages/RemoteViewerPage';
import { DashboardPage } from './pages/DashboardPage';
import { HistoryPage } from './pages/HistoryPage';
import { UsersPage } from './pages/UsersPage';
import { SettingsPage } from './pages/SettingsPage';
import {
  FileTransferRecord,
  RemoteSession,
  SessionMessage,
} from './types/remoteDesk';

function RemoteDeskWorkspace() {
  const {
    profile,
    device,
    iceServers,
    socket,
    connectionState,
    authError,
    signInWithGoogle,
    signOut,
    apiFetch,
  } = useAuth();

  const [currentPage, setCurrentPage] = useState<AppPage>('landing');
  const [showSignInModal, setShowSignInModal] = useState(false);

  const [activeSession, setActiveSession] = useState<RemoteSession | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [lastRemoteInput, setLastRemoteInput] = useState<RemoteInputEvent | null>(
    null
  );
  const [lastClipboardReceived, setLastClipboardReceived] = useState<{
    text: string;
    senderName: string;
  } | null>(null);

  const prevStatusRef = useRef<RemoteSession['status'] | null>(null);
  const prevEmergencyRef = useRef<string | null | undefined>(null);
  const activeSessionRef = useRef<RemoteSession | null>(activeSession);
  const profileRef = useRef(profile);

  useEffect(() => {
    activeSessionRef.current = activeSession;
  }, [activeSession]);

  useEffect(() => {
    profileRef.current = profile;
  }, [profile]);

  const isHost = Boolean(
    activeSession && profile && activeSession.hostUid === profile.uid
  );

  const handleRemoteClipboard = useCallback(
    (text: string, senderName: string) => {
      setLastClipboardReceived({ text, senderName });
      toast.info(`Clipboard received from ${senderName}`);
    },
    []
  );

  const handleRemoteInputReceived = useCallback((evt: RemoteInputEvent) => {
    setLastRemoteInput(evt);
  }, []);

  const {
    remoteStream,
    peerState,
    latencyMs,
    resolutionLabel,
    isRecording,
    replaceVideoTrack,
    sendRemoteInput,
    sendClipboardText,
    toggleRecording,
    cleanupPeer,
  } = useWebRTCSession({
    sessionId: activeSession?.id ?? null,
    role: isHost ? 'host' : 'technician',
    socket,
    iceServers,
    localStream,
    permissions: activeSession?.permissions ?? null,
    isActiveSession: activeSession?.status === 'active',
    onRemoteClipboard: handleRemoteClipboard,
    onRemoteInputReceived: handleRemoteInputReceived,
  });

  const stopLocalCapture = useCallback(() => {
    setLocalStream((prev) => {
      if (prev) {
        prev.getTracks().forEach((t) => t.stop());
      }
      return null;
    });
  }, []);

  const applySessionUpdate = useCallback(
    (next: RemoteSession) => {
      if (!profileRef.current) return;
      const currentProfile = profileRef.current;

      setActiveSession((prev) => {
        if (prev && prev.id !== next.id) return prev;

        const prevStatus = prevStatusRef.current;
        if (prevStatus && prevStatus !== next.status) {
          if (
            next.status === 'pending_approval' &&
            next.hostUid === currentProfile.uid
          ) {
            toast.info(
              `${next.technician?.displayName || 'IT Support'} is requesting to view your desk.`
            );
          } else if (
            next.status === 'active' &&
            next.technicianUid === currentProfile.uid
          ) {
            toast.success('Connection approved by employee.');
            setCurrentPage('viewer');
          } else if (
            prevStatus === 'pending_approval' &&
            next.status === 'waiting' &&
            next.technicianUid === null &&
            prev?.technicianUid === currentProfile.uid
          ) {
            toast.error('Connection request was dismissed by the host.');
            cleanupPeer();
            setCurrentPage('landing');
            prevStatusRef.current = null;
            return null;
          } else if (next.status === 'ended' || next.status === 'expired') {
            toast.info(next.endReason || 'Remote session ended.');
            cleanupPeer();
            stopLocalCapture();
            setAccessToken(null);
            setCurrentPage((cur) =>
              cur === 'viewer' || cur === 'share' ? 'landing' : cur
            );
            prevStatusRef.current = null;
            return null;
          }
        }

        if (
          next.permissions?.emergencyStoppedAt &&
          prevEmergencyRef.current !== next.permissions.emergencyStoppedAt
        ) {
          if (prevEmergencyRef.current !== undefined) {
            toast.warning(
              'Emergency Stop activated: remote control, clipboard, file transfer, and recording disabled.'
            );
          }
        }

        prevStatusRef.current = next.status;
        prevEmergencyRef.current = next.permissions?.emergencyStoppedAt;
        return next;
      });
    },
    [cleanupPeer, stopLocalCapture]
  );

  // Real-time Socket.IO synchronization for active session, messages, files & control
  useEffect(() => {
    if (!socket || !profile) return;

    const handleSessionUpdated = (updated: RemoteSession) => {
      if (activeSessionRef.current?.id === updated.id) {
        applySessionUpdate(updated);
      }
    };

    const handleSessionMessage = (msg: SessionMessage) => {
      setActiveSession((prev) => {
        if (!prev || prev.id !== msg.sessionId) return prev;
        if (prev.messages.some((m) => m.id === msg.id)) return prev;
        return { ...prev, messages: [...prev.messages, msg] };
      });
    };

    const handleSessionFile = (file: FileTransferRecord) => {
      setActiveSession((prev) => {
        if (!prev || prev.id !== file.sessionId) return prev;
        if (prev.files.some((f) => f.id === file.id)) return prev;
        return { ...prev, files: [file, ...prev.files] };
      });
    };

    const handleControlRequest = (payload: {
      sessionId: string;
      capability: string;
      requesterName: string;
    }) => {
      if (activeSessionRef.current?.id === payload.sessionId && isHost) {
        toast.info(
          `${payload.requesterName} is requesting ${payload.capability} permission.`
        );
      }
    };

    const handleClipboardSync = (payload: {
      sessionId: string;
      text: string;
      senderName: string;
    }) => {
      if (activeSessionRef.current?.id === payload.sessionId) {
        setLastClipboardReceived({
          text: payload.text,
          senderName: payload.senderName,
        });
        toast.info(`Clipboard updated by ${payload.senderName}`);
      }
    };

    const handleRemoteInput = (
      payload: RemoteInputEvent & { sessionId: string }
    ) => {
      if (activeSessionRef.current?.id === payload.sessionId && isHost) {
        setLastRemoteInput(payload);
      }
    };

    socket.on('session:updated', handleSessionUpdated);
    socket.on('session:message', handleSessionMessage);
    socket.on('session:file', handleSessionFile);
    socket.on('session:control-request', handleControlRequest);
    socket.on('session:clipboard-sync', handleClipboardSync);
    socket.on('session:remote-input', handleRemoteInput);

    return () => {
      socket.off('session:updated', handleSessionUpdated);
      socket.off('session:message', handleSessionMessage);
      socket.off('session:file', handleSessionFile);
      socket.off('session:control-request', handleControlRequest);
      socket.off('session:clipboard-sync', handleClipboardSync);
      socket.off('session:remote-input', handleRemoteInput);
    };
  }, [applySessionUpdate, isHost, profile, socket]);

  const handleRequireAuth = async () => {
    setShowSignInModal(true);
  };

  const handleGoogleSignIn = async () => {
    try {
      const user = await signInWithGoogle();
      if (user) {
        setShowSignInModal(false);
        toast.success(`Signed in as ${user.displayName}`);
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Google Sign-In was cancelled.'
      );
    }
  };

  const handleStopSharing = useCallback(
    async (reason?: string) => {
      const sid = activeSessionRef.current?.id;
      const wasHost = Boolean(
        activeSessionRef.current &&
          profileRef.current &&
          activeSessionRef.current.hostUid === profileRef.current.uid
      );
      const currentProfile = profileRef.current;
      cleanupPeer();
      stopLocalCapture();
      activeSessionRef.current = null;
      setActiveSession(null);
      setAccessToken(null);
      setCurrentPage('landing');

      if (sid && currentProfile) {
        const finalReason =
          typeof reason === 'string' && reason.trim()
            ? reason
            : wasHost
              ? 'Host stopped screen sharing'
              : 'IT Support technician disconnected';
        await disconnectSession(apiFetch, sid, finalReason).catch(() => {});
        toast.success(
          wasHost
            ? 'Screen sharing stopped and session closed.'
            : 'Disconnected from remote support session.'
        );
      }
    },
    [apiFetch, cleanupPeer, stopLocalCapture]
  );

  const handleStartSharing = async (issueSummary: string) => {
    if (!profile || !device) {
      setShowSignInModal(true);
      return;
    }

    if (!navigator.mediaDevices?.getDisplayMedia) {
      toast.error(
        'Screen sharing requires a modern desktop browser supporting display capture.'
      );
      return;
    }

    let capturedStream: MediaStream;
    try {
      capturedStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
        },
        audio: false,
      });
    } catch (err) {
      toast.error(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Screen capture permission was denied. Please grant permission to share your desk.'
          : 'Unable to capture screen in this browser window.'
      );
      return;
    }

    try {
      const { session, accessToken: token } = await createRemoteSession(
        apiFetch,
        {
          deviceId: device.id,
          issueSummary,
        }
      );

      const videoTrack = capturedStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          void handleStopSharing();
        };
      }

      prevStatusRef.current = session.status;
      activeSessionRef.current = session;
      setLocalStream(capturedStream);
      setActiveSession(session);
      setAccessToken(token);
      toast.success(
        'Screen sharing session created. Share the ID and code with IT Support.'
      );
    } catch (err) {
      capturedStream.getTracks().forEach((t) => t.stop());
      toast.error(
        err instanceof Error ? err.message : 'Failed to initialize session.'
      );
    }
  };

  const handleSwitchScreen = async () => {
    try {
      const nextStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30, max: 60 } },
        audio: false,
      });
      const prevStream = localStream;
      if (prevStream) {
        prevStream.getTracks().forEach((t) => {
          t.onended = null;
          t.stop();
        });
      }
      const nextTrack = nextStream.getVideoTracks()[0];
      if (nextTrack) {
        nextTrack.onended = () => {
          void handleStopSharing();
        };
      }
      setLocalStream(nextStream);
      await replaceVideoTrack(nextStream);
      toast.success('Switched shared screen.');
    } catch {
      toast.info('Screen switch cancelled.');
    }
  };

  const handleJoinSession = async (sessionCode: string, token: string) => {
    if (!profile) {
      setShowSignInModal(true);
      return;
    }
    const session = await joinRemoteSession(apiFetch, {
      sessionCode,
      accessToken: token,
    });
    prevStatusRef.current = session.status;
    activeSessionRef.current = session;
    setActiveSession(session);
    setAccessToken(null);
    setCurrentPage('viewer');
    toast.success('Connection request sent. Waiting for employee approval.');
  };

  const handleApproveIncoming = async (perms: {
    profileName: 'Default' | 'View Only' | 'Full Support';
    canViewScreen: boolean;
    canControlInput: boolean;
    canShareClipboard: boolean;
    canTransferFiles: boolean;
    canRecordSession: boolean;
  }) => {
    if (!activeSession || !profile) return;
    const updated = await approveIncomingSession(apiFetch, activeSession.id, perms);
    setActiveSession(updated);
    prevStatusRef.current = updated.status;
    setCurrentPage('share');
    toast.success('Support connection approved.');
  };

  const handleRejectIncoming = async () => {
    if (!activeSession || !profile) return;
    const updated = await rejectIncomingSession(apiFetch, activeSession.id);
    setActiveSession(updated);
    prevStatusRef.current = updated.status;
    toast.info('Incoming connection dismissed.');
  };

  const handleUpdatePermissions = async (updates: {
    canViewScreen?: boolean;
    canControlInput?: boolean;
    canShareClipboard?: boolean;
    canTransferFiles?: boolean;
    canRecordSession?: boolean;
    emergencyStop?: boolean;
  }) => {
    if (!activeSession || !profile) return;
    const { session: updated } = await updateSessionPermissions(
      apiFetch,
      activeSession.id,
      updates
    );
    setActiveSession(updated);
  };

  const handleOpenSessionFromDashboard = async (
    sessionId: string,
    mode: 'host' | 'viewer'
  ) => {
    if (!profile) return;
    const session = await getSessionByIdApi(apiFetch, sessionId);
    prevStatusRef.current = session.status;
    activeSessionRef.current = session;
    setActiveSession(session);
    setCurrentPage(mode === 'host' ? 'share' : 'viewer');
  };

  const handleNavigate = (page: AppPage) => {
    if (page !== 'landing' && !profile) {
      setShowSignInModal(true);
      return;
    }
    if (page === 'viewer' && !activeSession) {
      setCurrentPage('landing');
      return;
    }
    if (page === 'share' && !activeSession) {
      setCurrentPage('landing');
      return;
    }
    setCurrentPage(page);
  };

  return (
    <div className="min-h-screen bg-[#F4F5F7] text-[#111827] flex flex-col">
      <Toaster position="top-right" richColors />

      <Header
        currentPage={currentPage}
        onNavigate={handleNavigate}
        profile={profile}
        connectionState={connectionState}
        onSignIn={() => setShowSignInModal(true)}
        onSignOut={async () => {
          await handleStopSharing();
          await signOut();
          setCurrentPage('landing');
        }}
        hasActiveSession={Boolean(activeSession)}
        isHostSession={isHost}
      />

      {authError && !profile && !showSignInModal && (
        <div
          role="alert"
          className="max-w-6xl w-full mx-auto px-4 sm:px-6 pt-4"
        >
          <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-xs text-[#D32027] flex items-center justify-between gap-3">
            <span>{authError}</span>
            <button
              type="button"
              onClick={() => setShowSignInModal(true)}
              className="font-semibold underline shrink-0 cursor-pointer"
            >
              Sign In
            </button>
          </div>
        </div>
      )}

      {currentPage === 'landing' && (
        <LandingPage
          activeSession={activeSession}
          accessToken={accessToken}
          localStream={localStream}
          onStartSharing={handleStartSharing}
          onStopSharing={handleStopSharing}
          onJoinSession={handleJoinSession}
          onOpenHostWorkspace={() => setCurrentPage('share')}
          onOpenViewer={() => setCurrentPage('viewer')}
          onRequireAuth={handleRequireAuth}
        />
      )}

      {currentPage === 'share' && activeSession && (
        <ShareDeskPage
          session={activeSession}
          accessToken={accessToken}
          localStream={localStream}
          latencyMs={latencyMs}
          peerState={peerState}
          lastRemoteInput={lastRemoteInput}
          lastClipboardReceived={lastClipboardReceived}
          onSwitchScreen={handleSwitchScreen}
          onStopSharing={handleStopSharing}
          onUpdatePermissions={handleUpdatePermissions}
          onSendClipboard={(text) =>
            sendClipboardText(text, profile?.displayName || 'Host')
          }
          onBack={() => setCurrentPage('landing')}
        />
      )}

      {currentPage === 'viewer' && activeSession && (
        <RemoteViewerPage
          session={activeSession}
          remoteStream={remoteStream}
          peerState={peerState}
          latencyMs={latencyMs}
          resolutionLabel={resolutionLabel}
          isRecording={isRecording}
          lastClipboardReceived={lastClipboardReceived}
          onRequestCapability={(capability) => {
            socket?.emit('session:control-request', {
              sessionId: activeSession.id,
              capability,
            });
          }}
          onSendRemoteInput={sendRemoteInput}
          onSendClipboard={(text) =>
            sendClipboardText(text, profile?.displayName || 'Technician')
          }
          onToggleRecording={toggleRecording}
          onEmergencyStop={() => handleUpdatePermissions({ emergencyStop: true })}
          onDisconnect={handleStopSharing}
        />
      )}

      {currentPage === 'dashboard' && profile && (
        <DashboardPage onOpenSession={handleOpenSessionFromDashboard} />
      )}

      {currentPage === 'history' && profile && <HistoryPage />}

      {currentPage === 'users' && profile?.roleSlug === 'admin' && <UsersPage />}

      {currentPage === 'settings' && profile?.roleSlug === 'admin' && (
        <SettingsPage />
      )}

      {isHost &&
        activeSession &&
        activeSession.status === 'pending_approval' && (
          <IncomingApprovalDialog
            session={activeSession}
            requester={activeSession.technician}
            onApprove={handleApproveIncoming}
            onReject={handleRejectIncoming}
          />
        )}

      {showSignInModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
        >
          <Card className="w-full max-w-md p-6 relative">
            <button
              type="button"
              onClick={() => setShowSignInModal(false)}
              className="absolute top-4 right-4 text-neutral-400 hover:text-neutral-700 cursor-pointer"
              aria-label="Close sign in dialog"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <img
                src="/assets/aistudio/aee8f29a-8fc3-4160-b51e-cc82b16a854e_85c7cccb.png"
                alt="Vetiva Logo"
                referrerPolicy="no-referrer"
                className="h-10 w-10 object-contain"
              />
              <div>
                <h2 className="font-display text-lg font-bold text-neutral-900">
                  Vetiva Corporate Sign In
                </h2>
                <p className="text-xs text-neutral-500">
                  Virtual Remote Desk Authentication
                </p>
              </div>
            </div>

            <p className="text-sm text-neutral-600 mb-5 leading-relaxed">
              Sign in with your Google Workspace account to generate verified remote support codes, approve incoming IT connections, and log audit trails.
            </p>

            {authError && (
              <div className="mb-4 rounded-lg bg-red-50 border border-red-200 px-3 py-2 text-xs text-[#D32027]">
                {authError}
              </div>
            )}

            <Button
              type="button"
              variant="primary"
              size="lg"
              onClick={handleGoogleSignIn}
              className="w-full"
            >
              <ShieldCheck className="h-4 w-4" />
              <span>Continue with Google Workspace</span>
            </Button>
          </Card>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RemoteDeskWorkspace />
      </AuthProvider>
    </ErrorBoundary>
  );
}
