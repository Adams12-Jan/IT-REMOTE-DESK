import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Monitor,
  Radio,
  ShieldCheck,
  Square,
  ArrowRight,
  Laptop,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { formatSessionCode } from '../lib/utils';
import { RemoteSession } from '../types/remoteDesk';
import { Button, Card, Input } from '../components/ui/primitives';

interface LandingPageProps {
  activeSession: RemoteSession | null;
  accessToken: string | null;
  localStream: MediaStream | null;
  onStartSharing: (issueSummary: string) => Promise<void>;
  onStopSharing: () => Promise<void>;
  onJoinSession: (sessionCode: string, accessToken: string) => Promise<void>;
  onOpenHostWorkspace: () => void;
  onOpenViewer: () => void;
  onRequireAuth: () => Promise<void>;
}

export function LandingPage({
  activeSession,
  accessToken,
  localStream,
  onStartSharing,
  onStopSharing,
  onJoinSession,
  onOpenHostWorkspace,
  onOpenViewer,
  onRequireAuth,
}: LandingPageProps) {
  const { profile, device } = useAuth();
  const [issueSummary, setIssueSummary] = useState('Workstation Support');
  const [starting, setStarting] = useState(false);

  const [joinCode, setJoinCode] = useState('');
  const [joinAccessToken, setJoinAccessToken] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const previewVideoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (previewVideoRef.current && localStream) {
      previewVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  const isHostingActive =
    Boolean(activeSession) &&
    activeSession?.hostUid === profile?.uid &&
    (activeSession?.status === 'waiting' ||
      activeSession?.status === 'pending_approval' ||
      activeSession?.status === 'active');

  const isViewingActive =
    Boolean(activeSession) &&
    activeSession?.technicianUid === profile?.uid &&
    (activeSession?.status === 'pending_approval' ||
      activeSession?.status === 'active');

  const handleStartClick = async () => {
    if (!profile) {
      await onRequireAuth();
      return;
    }
    setStarting(true);
    try {
      await onStartSharing(issueSummary.trim() || 'IT Desk Screen Share');
    } finally {
      setStarting(false);
    }
  };

  const handleJoinSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setJoinError(null);

    const digits = joinCode.replace(/\s+/g, '');
    if (!/^\d{9,12}$/.test(digits)) {
      setJoinError('Enter a valid 9 to 12 digit Session ID.');
      return;
    }
    if (joinAccessToken.trim().length < 4) {
      setJoinError('Enter the single-use access code provided by the host.');
      return;
    }

    if (!profile) {
      await onRequireAuth();
      return;
    }

    setJoining(true);
    try {
      await onJoinSession(digits, joinAccessToken.trim().toUpperCase());
    } catch (err) {
      setJoinError(
        err instanceof Error ? err.message : 'Unable to connect to session.'
      );
    } finally {
      setJoining(false);
    }
  };

  const handleCopyInvite = async () => {
    if (!activeSession) return;
    const text = `Vetiva Virtual Remote Desk\nSession ID: ${formatSessionCode(activeSession.sessionCode)}\nAccess Code: ${accessToken || '(see host screen)'}`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Session ID and access code copied to clipboard.');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Browser blocked automatic clipboard write.');
    }
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-14">
      {/* Subtle Corporate Header Context */}
      <div className="mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold tracking-tight text-neutral-900">
            Vetiva Virtual Remote Desk
          </h1>
          <p className="mt-1.5 text-sm text-neutral-600 max-w-2xl">
            Encrypted remote support and screen sharing for Vetiva Capital Management Limited. Every session requires explicit employee approval.
          </p>
        </div>

        {device && (
          <div className="flex items-center gap-2.5 bg-white border border-neutral-200 rounded-lg px-3.5 py-2 text-xs text-neutral-700 shrink-0">
            <Laptop className="h-4 w-4 text-[#9C844B]" />
            <div>
              <span className="text-neutral-500">This Workstation: </span>
              <span className="font-mono font-semibold text-neutral-900">
                {formatSessionCode(device.deviceCode)}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Primary Two-Panel Landing Interface matching Screenshot 1 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        {/* LEFT PANEL – SHARE THIS DESK */}
        <Card className="p-7 sm:p-8 flex flex-col justify-between">
          <div>
            <div className="h-12 w-12 rounded-xl bg-[#D32027]/10 text-[#D32027] flex items-center justify-center mb-5">
              <Monitor className="h-6 w-6" />
            </div>

            <h2 className="font-display text-xl font-bold text-neutral-900">
              Share this desk
            </h2>
            <p className="mt-1.5 text-sm text-neutral-600">
              Start a session and invite your support person.
            </p>

            {!isHostingActive ? (
              <div className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="issue-summary"
                    className="block text-xs font-semibold text-neutral-700 mb-1.5"
                  >
                    Support topic (optional)
                  </label>
                  <Input
                    id="issue-summary"
                    value={issueSummary}
                    onChange={(e) => setIssueSummary(e.target.value)}
                    placeholder="e.g. Outlook configuration or Bloomberg terminal issue"
                    maxLength={120}
                  />
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-4">
                <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <div className="text-[11px] font-medium text-neutral-500">
                        Generated Session ID
                      </div>
                      <div className="font-mono text-2xl font-bold tracking-wider text-neutral-900 mt-0.5">
                        {formatSessionCode(activeSession!.sessionCode)}
                      </div>
                    </div>
                    {accessToken && (
                      <div className="text-right">
                        <div className="text-[11px] font-medium text-neutral-500">
                          Single-Use Code
                        </div>
                        <div className="font-mono text-lg font-bold tracking-widest text-[#D32027] mt-0.5">
                          {accessToken}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-neutral-200 text-xs">
                    <span className="text-neutral-600">
                      Status:{' '}
                      <strong className="text-neutral-900 capitalize">
                        {activeSession!.status.replace('_', ' ')}
                      </strong>
                    </span>
                    <button
                      type="button"
                      onClick={handleCopyInvite}
                      className="inline-flex items-center gap-1.5 font-semibold text-[#D32027] hover:text-[#B81920] cursor-pointer"
                    >
                      {copied ? (
                        <Check className="h-3.5 w-3.5" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                      <span>{copied ? 'Copied' : 'Copy Session Invite'}</span>
                    </button>
                  </div>
                </div>

                {localStream && (
                  <div className="rounded-lg overflow-hidden border border-neutral-200 bg-neutral-950 aspect-video relative">
                    <video
                      ref={previewVideoRef}
                      autoPlay
                      muted
                      playsInline
                      className="w-full h-full object-contain"
                    />
                    <div className="absolute bottom-2 left-2 bg-black/70 text-white text-[11px] px-2 py-1 rounded">
                      Live screen capture active
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-7 pt-5 border-t border-neutral-100 flex flex-wrap items-center gap-3">
            {!isHostingActive ? (
              <Button
                type="button"
                variant="primary"
                size="lg"
                onClick={handleStartClick}
                disabled={starting}
                className="w-full sm:w-auto"
              >
                <Monitor className="h-4 w-4" />
                <span>
                  {starting ? 'Requesting Screen Permission...' : 'Start Screen Sharing'}
                </span>
              </Button>
            ) : (
              <>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={onStopSharing}
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span>Stop Sharing</span>
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={onOpenHostWorkspace}
                >
                  <span>Open Host Console</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
        </Card>

        {/* RIGHT PANEL – JOIN A SESSION */}
        <Card className="p-7 sm:p-8 flex flex-col justify-between">
          <form onSubmit={handleJoinSubmit} className="flex flex-col justify-between h-full">
            <div>
              <div className="h-12 w-12 rounded-xl bg-neutral-100 text-neutral-800 flex items-center justify-center mb-5">
                <Radio className="h-6 w-6" />
              </div>

              <h2 className="font-display text-xl font-bold text-neutral-900">
                Join a session
              </h2>
              <p className="mt-1.5 text-sm text-neutral-600">
                Enter a code from the person sharing their screen.
              </p>

              <div className="mt-6 space-y-4">
                <div>
                  <label
                    htmlFor="join-session-code"
                    className="block text-xs font-semibold text-neutral-700 mb-1.5"
                  >
                    Session ID (9–12 digits)
                  </label>
                  <Input
                    id="join-session-code"
                    value={joinCode}
                    onChange={(e) => {
                      setJoinError(null);
                      setJoinCode(e.target.value);
                    }}
                    placeholder="e.g. 482 910 3471"
                    className="font-mono text-base tracking-wider"
                    inputMode="numeric"
                    autoComplete="off"
                  />
                </div>

                <div>
                  <label
                    htmlFor="join-access-code"
                    className="block text-xs font-semibold text-neutral-700 mb-1.5"
                  >
                    Single-Use Access Code
                  </label>
                  <Input
                    id="join-access-code"
                    value={joinAccessToken}
                    onChange={(e) => {
                      setJoinError(null);
                      setJoinAccessToken(e.target.value.toUpperCase());
                    }}
                    placeholder="e.g. K7M4P9"
                    className="font-mono text-base tracking-widest uppercase"
                    maxLength={12}
                    autoComplete="off"
                  />
                </div>

                {joinError && (
                  <p className="text-xs font-medium text-[#D32027]" role="alert">
                    {joinError}
                  </p>
                )}
              </div>
            </div>

            <div className="mt-7 pt-5 border-t border-neutral-100 flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                size="lg"
                disabled={joining}
                className="w-full sm:w-auto"
              >
                <Radio className="h-4 w-4" />
                <span>{joining ? 'Validating Code...' : 'Join Session'}</span>
              </Button>

              {isViewingActive && (
                <Button
                  type="button"
                  variant="outline"
                  size="md"
                  onClick={onOpenViewer}
                >
                  <span>Resume Remote Viewer</span>
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </div>
          </form>
        </Card>
      </div>

      {/* Security & Architecture Assurance Strip */}
      <div className="mt-6 bg-white border border-[#E5E7EB] rounded-xl px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs text-neutral-600">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="h-4 w-4 text-[#16A34A] shrink-0" />
          <span>
            End-to-end DTLS-SRTP WebRTC media encryption · Explicit host consent required · Unattended access disabled by default
          </span>
        </div>
        <div className="text-neutral-500 shrink-0">
          Vetiva Capital Management Limited · IT Infrastructure
        </div>
      </div>
    </main>
  );
}
