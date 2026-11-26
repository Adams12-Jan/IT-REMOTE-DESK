import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Clipboard,
  Copy,
  FileUp,
  Keyboard,
  Monitor,
  OctagonAlert,
  RefreshCw,
  ShieldCheck,
  Square,
  Video,
} from 'lucide-react';
import { toast } from 'sonner';
import { RemoteInputEvent } from '../hooks/useWebRTCSession';
import { formatDuration, formatSessionCode } from '../lib/utils';
import { RemoteSession } from '../types/remoteDesk';
import { SessionChatAndFiles } from '../components/SessionChatAndFiles';
import { Button, Card, Switch } from '../components/ui/primitives';

interface ShareDeskPageProps {
  session: RemoteSession;
  accessToken: string | null;
  localStream: MediaStream | null;
  latencyMs: number;
  peerState: RTCPeerConnectionState;
  lastRemoteInput: RemoteInputEvent | null;
  lastClipboardReceived: { text: string; senderName: string } | null;
  onSwitchScreen: () => Promise<void>;
  onStopSharing: () => Promise<void>;
  onUpdatePermissions: (updates: {
    canViewScreen?: boolean;
    canControlInput?: boolean;
    canShareClipboard?: boolean;
    canTransferFiles?: boolean;
    canRecordSession?: boolean;
    emergencyStop?: boolean;
  }) => Promise<void>;
  onSendClipboard: (text: string) => void;
  onBack: () => void;
}

export function ShareDeskPage({
  session,
  accessToken,
  localStream,
  latencyMs,
  peerState,
  lastRemoteInput,
  lastClipboardReceived,
  onSwitchScreen,
  onStopSharing,
  onUpdatePermissions,
  onSendClipboard,
  onBack,
}: ShareDeskPageProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [elapsed, setElapsed] = useState('00:00');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (videoRef.current && localStream) {
      videoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    const tick = () => setElapsed(formatDuration(session.startedAt, session.endedAt));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [session.startedAt, session.endedAt]);

  const perms = session.permissions;

  const handleCopy = async () => {
    const text = `Session ID: ${formatSessionCode(session.sessionCode)}${accessToken ? `\nAccess Code: ${accessToken}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Session credentials copied.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Browser blocked automatic clipboard write.');
    }
  };

  const handlePushClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text) {
        toast.info('Your clipboard is empty.');
        return;
      }
      onSendClipboard(text);
      toast.success('Clipboard sent to IT Support technician.');
    } catch {
      toast.error('Browser blocked automatic clipboard read.');
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      {/* Top Action Header */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
            <span>Back</span>
          </Button>
          <div>
            <h1 className="font-display text-lg font-bold text-neutral-900">
              Share This Desk · Host Console
            </h1>
            <p className="text-xs text-neutral-500">
              {session.issueSummary} · Session{' '}
              <span className="font-mono font-semibold text-neutral-800">
                {formatSessionCode(session.sessionCode)}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onSwitchScreen}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Switch Screen / Display</span>
          </Button>

          <Button
            type="button"
            variant="primary"
            size="sm"
            onClick={() => onUpdatePermissions({ emergencyStop: true })}
            title="Immediately revoke remote control, clipboard, file transfer, and recording"
          >
            <OctagonAlert className="h-4 w-4" />
            <span>Emergency Stop Remote Control</span>
          </Button>

          <Button
            type="button"
            variant="dark"
            size="sm"
            onClick={onStopSharing}
          >
            <Square className="h-3.5 w-3.5 fill-current" />
            <span>Stop Sharing & End</span>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Left 8 Columns: Live Screen Preview + Granular Permissions */}
        <div className="lg:col-span-8 space-y-5">
          {/* Status & Credentials Strip */}
          <Card className="p-4 grid grid-cols-2 sm:grid-cols-4 gap-4 items-center">
            <div>
              <div className="text-[11px] text-neutral-500">Session ID</div>
              <div className="font-mono text-sm font-bold text-neutral-900">
                {formatSessionCode(session.sessionCode)}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">Single-Use Code</div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm font-bold text-[#D32027]">
                  {accessToken || '••••••'}
                </span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-neutral-500 hover:text-neutral-900 cursor-pointer"
                  aria-label="Copy session invite"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-[#16A34A]" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">Connected Technician</div>
              <div className="text-xs font-semibold text-neutral-900 truncate">
                {session.technician?.displayName || 'Waiting for technician'}
              </div>
            </div>
            <div>
              <div className="text-[11px] text-neutral-500">Duration · Latency</div>
              <div className="font-mono text-xs font-semibold text-neutral-900">
                {elapsed} · {latencyMs > 0 ? `${latencyMs} ms` : peerState}
              </div>
            </div>
          </Card>

          {/* Screen Share Preview */}
          <Card className="overflow-hidden bg-neutral-950 border-neutral-800">
            <div className="aspect-video w-full flex items-center justify-center relative">
              {localStream ? (
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-center text-neutral-400 p-6">
                  <Monitor className="h-10 w-10 mx-auto mb-2 opacity-60" />
                  <p className="text-sm font-medium text-neutral-200">
                    No active screen capture stream
                  </p>
                  <p className="text-xs mt-1">
                    Click Switch Screen / Display above to choose a monitor or window.
                  </p>
                </div>
              )}

              {perms?.canControlInput && (
                <div className="absolute top-3 left-3 bg-[#D32027] text-white text-xs font-semibold px-3 py-1.5 rounded-lg shadow">
                  Remote Control Permitted
                  {lastRemoteInput
                    ? ` · Last input: ${lastRemoteInput.eventType}`
                    : ''}
                </div>
              )}
            </div>
          </Card>

          {/* Granular Explicit Consent Controls */}
          <Card className="p-5">
            <div className="flex items-center justify-between gap-4 mb-4">
              <div>
                <h2 className="font-display text-sm font-bold text-neutral-900">
                  Remote Support Permissions
                </h2>
                <p className="text-xs text-neutral-500">
                  All capabilities require your explicit approval and can be revoked instantly.
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs font-medium text-[#15803D]">
                <ShieldCheck className="h-4 w-4" />
                <span>Unattended Access: Off</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-neutral-200">
                <div className="flex items-center gap-2.5">
                  <Monitor className="h-4 w-4 text-neutral-700" />
                  <div>
                    <div className="text-xs font-semibold text-neutral-900">
                      Screen Viewing
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Allow technician to see shared display
                    </div>
                  </div>
                </div>
                <Switch
                  ariaLabel="Toggle screen viewing"
                  checked={Boolean(perms?.canViewScreen)}
                  onCheckedChange={(v) =>
                    onUpdatePermissions({ canViewScreen: v })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-neutral-200">
                <div className="flex items-center gap-2.5">
                  <Keyboard className="h-4 w-4 text-neutral-700" />
                  <div>
                    <div className="text-xs font-semibold text-neutral-900">
                      Keyboard & Mouse Control
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Forwarded via companion native desktop agent
                    </div>
                  </div>
                </div>
                <Switch
                  ariaLabel="Toggle keyboard and mouse control"
                  checked={Boolean(perms?.canControlInput)}
                  onCheckedChange={(v) =>
                    onUpdatePermissions({ canControlInput: v })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-neutral-200">
                <div className="flex items-center gap-2.5">
                  <Clipboard className="h-4 w-4 text-neutral-700" />
                  <div>
                    <div className="text-xs font-semibold text-neutral-900">
                      Clipboard Sharing
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Sync copied text securely over DataChannel
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {perms?.canShareClipboard && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handlePushClipboard}
                    >
                      Send
                    </Button>
                  )}
                  <Switch
                    ariaLabel="Toggle clipboard sharing"
                    checked={Boolean(perms?.canShareClipboard)}
                    onCheckedChange={(v) =>
                      onUpdatePermissions({ canShareClipboard: v })
                    }
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-neutral-200">
                <div className="flex items-center gap-2.5">
                  <FileUp className="h-4 w-4 text-neutral-700" />
                  <div>
                    <div className="text-xs font-semibold text-neutral-900">
                      File Transfer
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Allow scanned file upload & download
                    </div>
                  </div>
                </div>
                <Switch
                  ariaLabel="Toggle file transfer"
                  checked={Boolean(perms?.canTransferFiles)}
                  onCheckedChange={(v) =>
                    onUpdatePermissions({ canTransferFiles: v })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-3 p-3 rounded-lg border border-neutral-200 sm:col-span-2">
                <div className="flex items-center gap-2.5">
                  <Video className="h-4 w-4 text-neutral-700" />
                  <div>
                    <div className="text-xs font-semibold text-neutral-900">
                      Session Recording Consent
                    </div>
                    <div className="text-[11px] text-neutral-500">
                      Only allow technician to record stream when explicitly enabled
                    </div>
                  </div>
                </div>
                <Switch
                  ariaLabel="Toggle session recording consent"
                  checked={Boolean(perms?.canRecordSession)}
                  onCheckedChange={(v) =>
                    onUpdatePermissions({ canRecordSession: v })
                  }
                />
              </div>
            </div>

            {lastClipboardReceived && (
              <div className="mt-3 p-3 rounded-lg bg-neutral-50 border border-neutral-200 flex items-center justify-between gap-3 text-xs">
                <div className="min-w-0">
                  <span className="font-semibold text-neutral-800">
                    Clipboard from {lastClipboardReceived.senderName}:{' '}
                  </span>
                  <span className="font-mono text-neutral-600 truncate">
                    {lastClipboardReceived.text}
                  </span>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(lastClipboardReceived.text);
                      toast.success('Copied to your local clipboard.');
                    } catch {
                      toast.error('Browser blocked automatic clipboard write.');
                    }
                  }}
                >
                  Copy
                </Button>
              </div>
            )}
          </Card>
        </div>

        {/* Right 4 Columns: Live Chat & File Transfer */}
        <div className="lg:col-span-4">
          <SessionChatAndFiles
            session={session}
            messages={session.messages}
            files={session.files}
            permissions={session.permissions}
          />
        </div>
      </div>
    </main>
  );
}
