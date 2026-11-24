import React, { useEffect, useRef, useState } from 'react';
import {
  CircleDot,
  Clipboard,
  FileUp,
  Keyboard,
  Maximize2,
  MessageSquare,
  Minimize2,
  Monitor,
  OctagonAlert,
  PhoneOff,
  Shrink,
  Video,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { toast } from 'sonner';
import { RemoteInputEvent } from '../hooks/useWebRTCSession';
import { formatDuration, formatSessionCode } from '../lib/utils';
import { RemoteSession } from '../types/remoteDesk';
import { SessionChatAndFiles } from '../components/SessionChatAndFiles';
import { Button } from '../components/ui/primitives';

interface RemoteViewerPageProps {
  session: RemoteSession;
  remoteStream: MediaStream | null;
  peerState: RTCPeerConnectionState;
  latencyMs: number;
  resolutionLabel: string;
  isRecording: boolean;
  lastClipboardReceived: { text: string; senderName: string } | null;
  onRequestCapability: (
    capability: 'control' | 'clipboard' | 'files' | 'recording'
  ) => void;
  onSendRemoteInput: (event: RemoteInputEvent) => void;
  onSendClipboard: (text: string) => void;
  onToggleRecording: () => void;
  onEmergencyStop: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function RemoteViewerPage({
  session,
  remoteStream,
  peerState,
  latencyMs,
  resolutionLabel,
  isRecording,
  lastClipboardReceived,
  onRequestCapability,
  onSendRemoteInput,
  onSendClipboard,
  onToggleRecording,
  onEmergencyStop,
  onDisconnect,
}: RemoteViewerPageProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastMoveSentRef = useRef<number>(0);

  const [fitToWindow, setFitToWindow] = useState(true);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'chat' | 'files' | null>('chat');
  const [elapsed, setElapsed] = useState('00:00');
  const [clipboardDraft, setClipboardDraft] = useState('');

  useEffect(() => {
    if (videoRef.current && remoteStream) {
      videoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  useEffect(() => {
    const tick = () => setElapsed(formatDuration(session.startedAt, session.endedAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session.startedAt, session.endedAt]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  };

  const perms = session.permissions;

  const qualityLabel =
    latencyMs === 0
      ? 'Measuring'
      : latencyMs < 50
        ? 'Excellent'
        : latencyMs < 140
          ? 'Good'
          : 'Fair';

  const qualityColor =
    latencyMs === 0
      ? 'text-neutral-300'
      : latencyMs < 50
        ? 'text-emerald-400'
        : latencyMs < 140
          ? 'text-green-400'
          : 'text-amber-400';

  const computeNormalizedCoords = (e: React.MouseEvent<HTMLVideoElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  };

  const handleVideoMouseMove = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!perms?.canControlInput) return;
    const now = performance.now();
    if (now - lastMoveSentRef.current < 32) return; // ~30Hz throttle
    lastMoveSentRef.current = now;
    const { x, y } = computeNormalizedCoords(e);
    onSendRemoteInput({ eventType: 'mousemove', x, y });
  };

  const handleVideoMouseDown = (e: React.MouseEvent<HTMLVideoElement>) => {
    if (!perms?.canControlInput) return;
    const { x, y } = computeNormalizedCoords(e);
    onSendRemoteInput({ eventType: 'mousedown', x, y, button: e.button });
  };

  const handleVideoKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!perms?.canControlInput) return;
    e.preventDefault();
    onSendRemoteInput({ eventType: 'keydown', key: e.key });
  };

  const handleClipboardAction = async () => {
    if (!perms?.canShareClipboard) {
      onRequestCapability('clipboard');
      toast.info('Requested clipboard sharing permission from host.');
      return;
    }
    if (clipboardDraft.trim()) {
      onSendClipboard(clipboardDraft.trim());
      setClipboardDraft('');
      toast.success('Clipboard text sent to host.');
      return;
    }
    try {
      const txt = await navigator.clipboard.readText();
      if (txt) {
        onSendClipboard(txt);
        toast.success('Clipboard synced to host.');
      } else {
        toast.info('Local clipboard is empty.');
      }
    } catch {
      toast.info('Use the clipboard box below to send text manually.');
    }
  };

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-[calc(100vh-4rem)] bg-[#14171C] text-white overflow-hidden"
    >
      {/* Remote Support Toolbar */}
      <div className="bg-[#1F242D] border-b border-neutral-800 px-3 sm:px-4 py-2 flex flex-wrap items-center justify-between gap-2">
        {/* Left: Connected User Identity + Quality + Timer */}
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
            <div className="leading-tight min-w-0">
              <div className="text-xs font-semibold text-white truncate max-w-[180px]">
                {session.host?.displayName || 'Remote Desk'}
              </div>
              <div className="text-[11px] font-mono text-neutral-400">
                {formatSessionCode(session.sessionCode)}
              </div>
            </div>
          </div>

          <div className="hidden md:flex items-center gap-2 pl-3 border-l border-neutral-700 text-xs font-mono">
            <span className={qualityColor}>{qualityLabel}</span>
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-300">
              {latencyMs > 0 ? `${latencyMs} ms` : peerState}
            </span>
            {resolutionLabel && (
              <>
                <span className="text-neutral-500">·</span>
                <span className="text-neutral-400">{resolutionLabel}</span>
              </>
            )}
            <span className="text-neutral-500">·</span>
            <span className="text-neutral-200">{elapsed}</span>
          </div>
        </div>

        {/* Center: Screen View, Fit/Zoom, Fullscreen, Control, Clipboard, Files, Chat, Record */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              setFitToWindow(true);
              setZoomPercent(100);
            }}
            className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              fitToWindow
                ? 'bg-neutral-700 text-white'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
            title="Fit remote screen to window"
          >
            <Shrink className="h-3.5 w-3.5" />
            <span className="hidden xl:inline">Fit Screen</span>
          </button>

          <div className="flex items-center bg-neutral-800 rounded px-1">
            <button
              type="button"
              onClick={() => {
                setFitToWindow(false);
                setZoomPercent((z) => Math.max(50, z - 25));
              }}
              className="p-1 text-neutral-300 hover:text-white cursor-pointer"
              aria-label="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="font-mono text-[11px] px-1.5 text-neutral-200">
              {fitToWindow ? 'Auto' : `${zoomPercent}%`}
            </span>
            <button
              type="button"
              onClick={() => {
                setFitToWindow(false);
                setZoomPercent((z) => Math.min(150, z + 25));
              }}
              className="p-1 text-neutral-300 hover:text-white cursor-pointer"
              aria-label="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            type="button"
            onClick={toggleFullscreen}
            className="px-2.5 py-1.5 rounded text-xs font-medium text-neutral-300 hover:bg-neutral-800 flex items-center gap-1.5 cursor-pointer"
            title="Toggle full-screen mode"
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
            <span className="hidden xl:inline">
              {isFullscreen ? 'Exit Full' : 'Fullscreen'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (perms?.canControlInput) {
                void onEmergencyStop();
              } else {
                onRequestCapability('control');
                toast.info('Requested remote mouse & keyboard control from host.');
              }
            }}
            className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              perms?.canControlInput
                ? 'bg-[#16A34A] text-white'
                : 'bg-neutral-800 text-neutral-200 hover:bg-neutral-700'
            }`}
            title={
              perms?.canControlInput
                ? 'Remote control active (click to stop)'
                : 'Request remote keyboard & mouse control'
            }
          >
            <Keyboard className="h-3.5 w-3.5" />
            <span>
              {perms?.canControlInput ? 'Control Active' : 'Request Control'}
            </span>
          </button>

          {perms?.canControlInput && (
            <button
              type="button"
              onClick={onEmergencyStop}
              className="px-2.5 py-1.5 rounded text-xs font-semibold bg-[#D32027] hover:bg-[#B81920] text-white flex items-center gap-1.5 cursor-pointer"
            >
              <OctagonAlert className="h-3.5 w-3.5" />
              <span>Emergency Stop</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleClipboardAction}
            className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              perms?.canShareClipboard
                ? 'bg-neutral-700 text-white'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
            title="Clipboard sharing"
          >
            <Clipboard className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Clipboard</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setDrawerTab((cur) => (cur === 'files' ? null : 'files'))
            }
            className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              drawerTab === 'files'
                ? 'bg-[#3B69B2] text-white'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            <FileUp className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Files</span>
          </button>

          <button
            type="button"
            onClick={() =>
              setDrawerTab((cur) => (cur === 'chat' ? null : 'chat'))
            }
            className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              drawerTab === 'chat'
                ? 'bg-[#3B69B2] text-white'
                : 'text-neutral-300 hover:bg-neutral-800'
            }`}
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden lg:inline">Chat</span>
          </button>

          <button
            type="button"
            onClick={() => {
              if (!perms?.canRecordSession) {
                onRequestCapability('recording');
                toast.info('Requested explicit session recording consent from host.');
              } else {
                onToggleRecording();
              }
            }}
            className={`px-2.5 py-1.5 rounded text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
              isRecording
                ? 'bg-[#D32027] text-white'
                : perms?.canRecordSession
                  ? 'bg-neutral-700 text-white'
                  : 'text-neutral-400 hover:bg-neutral-800'
            }`}
            title="Record session (requires explicit host consent)"
          >
            {isRecording ? (
              <CircleDot className="h-3.5 w-3.5" />
            ) : (
              <Video className="h-3.5 w-3.5" />
            )}
            <span className="hidden xl:inline">
              {isRecording ? 'Stop Rec' : 'Record'}
            </span>
          </button>
        </div>

        {/* Right: Disconnect */}
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={onDisconnect}
        >
          <PhoneOff className="h-3.5 w-3.5" />
          <span>Disconnect</span>
        </Button>
      </div>

      {/* Main Viewer Viewport + Collapsible Chat/Files Drawer */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        <div
          tabIndex={0}
          onKeyDown={handleVideoKeyDown}
          className="flex-1 relative overflow-auto flex items-center justify-center bg-[#0D1014] outline-none"
        >
          {session.status === 'pending_approval' ? (
            <div className="text-center max-w-md px-6 py-8 rounded-xl bg-[#1C2129] border border-neutral-700">
              <Monitor className="h-10 w-10 text-[#D32027] mx-auto mb-3" />
              <h2 className="font-display text-base font-bold text-white">
                Waiting for Employee Approval
              </h2>
              <p className="text-xs text-neutral-300 mt-1.5 leading-relaxed">
                A connection request has been sent to{' '}
                <strong>{session.host?.displayName || 'the host'}</strong>.
                Screen streaming will begin immediately once they click Accept.
              </p>
            </div>
          ) : !perms?.canViewScreen ? (
            <div className="text-center max-w-md px-6 py-8 rounded-xl bg-[#1C2129] border border-neutral-700">
              <Monitor className="h-10 w-10 text-amber-400 mx-auto mb-3" />
              <h2 className="font-display text-base font-bold text-white">
                Screen Viewing Paused by Host
              </h2>
              <p className="text-xs text-neutral-300 mt-1.5">
                The employee temporarily disabled screen viewing permission.
              </p>
            </div>
          ) : remoteStream ? (
            <video
              ref={videoRef}
              autoPlay
              playsInline
              onMouseMove={handleVideoMouseMove}
              onMouseDown={handleVideoMouseDown}
              style={
                fitToWindow
                  ? undefined
                  : {
                      width: `${zoomPercent}%`,
                      maxWidth: 'none',
                    }
              }
              className={
                fitToWindow
                  ? 'max-h-full max-w-full object-contain'
                  : 'h-auto object-contain'
              }
            />
          ) : (
            <div className="text-center max-w-md px-6 py-8 rounded-xl bg-[#1C2129] border border-neutral-700">
              <Monitor className="h-10 w-10 text-neutral-400 mx-auto mb-3" />
              <h2 className="font-display text-base font-bold text-white">
                Establishing Encrypted WebRTC Stream
              </h2>
              <p className="text-xs text-neutral-400 mt-1.5">
                Signaling state: {peerState}. Ensure the host has selected a display in their browser.
              </p>
            </div>
          )}

          {/* Optional Clipboard Quick Bar when permitted */}
          {perms?.canShareClipboard && (
            <div className="absolute bottom-3 left-3 right-3 max-w-xl mx-auto bg-[#1C2129]/95 border border-neutral-700 rounded-lg px-3 py-2 flex items-center gap-2 text-xs">
              <Clipboard className="h-3.5 w-3.5 text-neutral-400 shrink-0" />
              <input
                value={clipboardDraft}
                onChange={(e) => setClipboardDraft(e.target.value)}
                placeholder={
                  lastClipboardReceived
                    ? `Received from ${lastClipboardReceived.senderName}: "${lastClipboardReceived.text.slice(0, 40)}"`
                    : 'Type or paste text to send to host clipboard...'
                }
                className="flex-1 bg-transparent text-white placeholder:text-neutral-400 outline-none text-xs"
              />
              <button
                type="button"
                onClick={handleClipboardAction}
                className="px-2.5 py-1 rounded bg-neutral-700 hover:bg-neutral-600 text-white font-medium cursor-pointer"
              >
                Send Clipboard
              </button>
            </div>
          )}
        </div>

        {/* Right Chat & File Transfer Drawer */}
        {drawerTab && (
          <div className="w-80 sm:w-96 border-l border-neutral-800 bg-white text-neutral-900 p-3 flex flex-col">
            <SessionChatAndFiles
              sessionId={session.id}
              messages={session.messages}
              files={session.files}
              permissions={session.permissions}
              activeTab={drawerTab}
              onTabChange={(t) => setDrawerTab(t)}
            />
          </div>
        )}
      </div>
    </div>
  );
}
