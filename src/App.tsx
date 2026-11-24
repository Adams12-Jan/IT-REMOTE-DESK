import React, { useCallback, useEffect, useState } from 'react';
import { Toaster, toast } from 'sonner';
import { ShieldCheck, X } from 'lucide-react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { RemoteInputEvent, useWebRTCSession } from './hooks/useWebRTCSession';
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
  SessionParticipantSummary,
  SessionPermissions,
} from './types/remoteDesk';

function RemoteDeskWorkspace() {
  const {
    profile,
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
  const [incomingRequester, setIncomingRequester] =
    useState<SessionParticipantSummary | null>(null);
  const [lastRemoteInput, setLastRemoteInput] = useState<RemoteInputEvent | null>(
    null
  );
  const [lastClipboardReceived, setLastClipboardReceived] = useState<{
    text: string;
    senderName: string;
  } | null>(null);

  const isHost = Boolean(
    activeSession && profile && activeSession.hostUserId === profile.id
  );

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
    onRemoteClipboard: (text, senderName) => {
      setLastClipboardReceived({ text, senderName });
      toast.info(`Clipboard received from ${senderName}`);
    },
    onRemoteInputReceived: (evt) => {
      setLastRemoteInput(evt);
    },
  });

  const stopLocalCapture = useCallback(() => {
    setLocalStream((prev) => {
      if (prev) {
        prev.getTracks().forEach((t) => t.stop());
      }
      return null;
    });
  }, []);

  const refreshActiveSession = useCallback(
    async (sessionId: number) => {
      const res = await apiFetch<{ session: RemoteSession }>(
        `/api/sessions/${sessionId}`
      );
      setActiveSession(res.session);
      return res.session;
    },
    [apiFetch]
  );

  // Real-time Socket.IO session event synchronization
  useEffect(() => {
    if (!socket || !profile) return;

    const handleIncomingRequest = async (payload: {
      sessionId: number;
      requester: SessionParticipantSummary;
      systemMessage?: SessionMessage;
    }) => {
      setIncomingRequester(payload.requester);
      toast.info(`${payload.requester.displayName} is requesting to view your desk.`);
      await refreshActiveSession(payload.sessionId).catch(() => {});
    };

    const handleApproved = (payload: {
      sessionId: number;
      session: RemoteSession;
    }) => {
      setIncomingRequester(null);
      setActiveSession(payload.session);
      if (payload.session.technicianUserId === profile.id) {
        toast.success('Connection approved by employee.');
        setCurrentPage('viewer');
      }
    };

    const handleRejected = (payload: { sessionId: number }) => {
      setIncomingRequester(null);
      if (
        activeSession?.id === payload.sessionId &&
        activeSession.technicianUserId === profile.id
      ) {
        toast.error('Connection request was dismissed by the host.');
        cleanupPeer();
        setActiveSession(null);
        setCurrentPage('landing');
      } else {
        void refreshActiveSession(payload.sessionId).catch(() => {});
      }
    };

    const handleDisconnected = (payload: {
      sessionId: number;
      reason?: string;
    }) => {
      if (activeSession?.id === payload.sessionId) {
        toast.info(payload.reason || 'Remote session ended.');
        cleanupPeer();
        stopLocalCapture();
        setIncomingRequester(null);
        setActiveSession(null);
        setAccessToken(null);
        if (currentPage === 'viewer' || currentPage === 'share') {
          setCurrentPage('landing');
        }
      }
    };

    const handlePermissionsUpdated = (payload: {
      sessionId: number;
      permissions: SessionPermissions;
      emergencyStop?: boolean;
    }) => {
      if (payload.emergencyStop) {
        toast.warning(
          'Emergency Stop activated: remote control, clipboard, file transfer, and recording disabled.'
        );
      }
      setActiveSession((prev) =>
        prev && prev.id === payload.sessionId
          ? { ...prev, permissions: payload.permissions }
          : prev
      );
    };

    const handleMessage = (payload: {
      sessionId: number;
      message: SessionMessage;
    }) => {
      setActiveSession((prev) => {
        if (!prev || prev.id !== payload.sessionId) return prev;
        // Idempotency guard against duplicate Socket/HTTP delivery
        if (prev.messages.some((m) => m.id === payload.message.id)) return prev;
        return { ...prev, messages: [...prev.messages, payload.message] };
      });
    };

    const handleFileUploaded = (payload: {
      sessionId: number;
      file: FileTransferRecord;
      uploaderName: string;
    }) => {
      toast.info(`New file from ${payload.uploaderName}: ${payload.file.originalName}`);
      setActiveSession((prev) => {
        if (!prev || prev.id !== payload.sessionId) return prev;
        if (prev.files.some((f) => f.id === payload.file.id)) return prev;
        return { ...prev, files: [payload.file, ...prev.files] };
      });
    };

    const handleControlRequest = (payload: {
      sessionId: number;
      capability: string;
      requesterName: string;
    }) => {
      if (activeSession?.id === payload.sessionId && isHost) {
        toast.info(
          `${payload.requesterName} is requesting ${payload.capability} permission.`
        );
      }
    };

    const handleClipboardSync = (payload: {
      sessionId: number;
      text: string;
      senderName: string;
    }) => {
      if (activeSession?.id === payload.sessionId) {
        setLastClipboardReceived({
          text: payload.text,
          senderName: payload.senderName,
        });
        toast.info(`Clipboard updated by ${payload.senderName}`);
      }
    };

    const handleRemoteInput = (
      payload: RemoteInputEvent & { sessionId: number }
    ) => {
      if (activeSession?.id === payload.sessionId && isHost) {
        setLastRemoteInput(payload);
      }
    };

    socket.on('session:incoming-request', handleIncomingRequest);
    socket.on('session:approved', handleApproved);
    socket.on('session:rejected', handleRejected);
    socket.on('session:disconnected', handleDisconnected);
    socket.on('session:permissions-updated', handlePermissionsUpdated);
    socket.on('session:message', handleMessage);
    socket.on('session:file-uploaded', handleFileUploaded);
    socket.on('session:control-request', handleControlRequest);
    socket.on('session:clipboard-sync', handleClipboardSync);
    socket.on('session:remote-input', handleRemoteInput);

    return () => {
      socket.off('session:incoming-request', handleIncomingRequest);
      socket.off('session:approved', handleApproved);
      socket.off('session:rejected', handleRejected);
      socket.off('session:disconnected', handleDisconnected);
      socket.off('session:permissions-updated', handlePermissionsUpdated);
      socket.off('session:message', handleMessage);
      socket.off('session:file-uploaded', handleFileUploaded);
      socket.off('session:control-request', handleControlRequest);
      socket.off('session:clipboard-sync', handleClipboardSync);
      socket.off('session:remote-input', handleRemoteInput);
    };
  }, [
    activeSession?.id,
    activeSession?.technicianUserId,
    cleanupPeer,
    currentPage,
    isHost,
    profile,
    refreshActiveSession,
    socket,
    stopLocalCapture,
  ]);

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

  const handleStartSharing = async (issueSummary: string) => {
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
      const res = await apiFetch<{
        session: RemoteSession;
        accessToken: string;
      }>('/api/sessions/create', {
        method: 'POST',
        body: JSON.stringify({ issueSummary }),
      });

      const videoTrack = capturedStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          void handleStopSharing();
        };
      }

      setLocalStream(capturedStream);
      setActiveSession(res.session);
      setAccessToken(res.accessToken);
      toast.success('Screen sharing session created. Share the ID and code with IT Support.');
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
      setLocalStream(nextStream);
      await replaceVideoTrack(nextStream);
      prevStream?.getTracks().forEach((t) => t.stop());
      toast.success('Switched shared screen.');
    } catch {
      toast.info('Screen switch cancelled.');
    }
  };

  const handleStopSharing = async () => {
    const sid = activeSession?.id;
    cleanupPeer();
    stopLocalCapture();
    setIncomingRequester(null);
    setActiveSession(null);
    setAccessToken(null);
    setCurrentPage('landing');

    if (sid) {
      await apiFetch(`/api/sessions/${sid}/disconnect`, {
        method: 'POST',
        body: JSON.stringify({ reason: 'Host stopped screen sharing' }),
      }).catch(() => {});
      toast.success('Screen sharing stopped and session closed.');
    }
  };

  const handleJoinSession = async (sessionCode: string, token: string) => {
    const res = await apiFetch<{ session: RemoteSession }>('/api/sessions/join', {
      method: 'POST',
      body: JSON.stringify({ sessionCode, accessToken: token }),
    });
    setActiveSession(res.session);
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
    if (!activeSession) return;
    const res = await apiFetch<{ session: RemoteSession }>(
      `/api/sessions/${activeSession.id}/approve`,
      {
        method: 'POST',
        body: JSON.stringify(perms),
      }
    );
    setIncomingRequester(null);
    setActiveSession(res.session);
    setCurrentPage('share');
    toast.success('Support connection approved.');
  };

  const handleRejectIncoming = async () => {
    if (!activeSession) return;
    const res = await apiFetch<{ session: RemoteSession }>(
      `/api/sessions/${activeSession.id}/reject`,
      { method: 'POST' }
    );
    setIncomingRequester(null);
    setActiveSession(res.session);
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
    if (!activeSession) return;
    const res = await apiFetch<{ permissions: SessionPermissions }>(
      `/api/sessions/${activeSession.id}/permissions`,
      {
        method: 'POST',
        body: JSON.stringify(updates),
      }
    );
    setActiveSession((prev) =>
      prev ? { ...prev, permissions: res.permissions } : prev
    );
  };

  const handleOpenSessionFromDashboard = async (
    sessionId: number,
    mode: 'host' | 'viewer'
  ) => {
    await refreshActiveSession(sessionId);
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
      />

      {/* Active Page Router */}
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

      {/* Incoming Connection Approval Dialog (Screenshot 2) */}
      {isHost &&
        activeSession &&
        activeSession.status === 'pending_approval' && (
          <IncomingApprovalDialog
            session={activeSession}
            requester={incomingRequester || activeSession.technician}
            onApprove={handleApproveIncoming}
            onReject={handleRejectIncoming}
          />
        )}

      {/* Corporate Google Sign-In Modal */}
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
                  IT Remote Desk Authentication
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
    <AuthProvider>
      <RemoteDeskWorkspace />
    </AuthProvider>
  );
}
