import React, { useState } from 'react';
import {
  Clipboard,
  FileUp,
  Keyboard,
  Monitor,
  ShieldCheck,
  Video,
  X,
} from 'lucide-react';
import { RemoteSession, SessionParticipantSummary } from '../types/remoteDesk';
import { SessionChatAndFiles } from './SessionChatAndFiles';
import { Button } from './ui/primitives';

interface IncomingApprovalDialogProps {
  session: RemoteSession;
  requester: SessionParticipantSummary | null;
  onApprove: (perms: {
    profileName: 'Default' | 'View Only' | 'Full Support';
    canViewScreen: boolean;
    canControlInput: boolean;
    canShareClipboard: boolean;
    canTransferFiles: boolean;
    canRecordSession: boolean;
  }) => Promise<void>;
  onReject: () => Promise<void>;
}

export function IncomingApprovalDialog({
  session,
  requester,
  onApprove,
  onReject,
}: IncomingApprovalDialogProps) {
  const [profileName, setProfileName] = useState<'Default' | 'View Only' | 'Full Support'>('Default');
  const [canControlInput, setCanControlInput] = useState(false);
  const [canTransferFiles, setCanTransferFiles] = useState(false);
  const [canShareClipboard, setCanShareClipboard] = useState(false);
  const [canRecordSession, setCanRecordSession] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const applyProfile = (next: 'Default' | 'View Only' | 'Full Support') => {
    setProfileName(next);
    if (next === 'View Only') {
      setCanControlInput(false);
      setCanTransferFiles(false);
      setCanShareClipboard(false);
      setCanRecordSession(false);
    } else if (next === 'Full Support') {
      setCanControlInput(true);
      setCanTransferFiles(true);
      setCanShareClipboard(true);
      setCanRecordSession(false);
    } else {
      setCanControlInput(false);
      setCanTransferFiles(true);
      setCanShareClipboard(true);
      setCanRecordSession(false);
    }
  };

  const handleAccept = async () => {
    setSubmitting(true);
    try {
      await onApprove({
        profileName,
        canViewScreen: true,
        canControlInput,
        canShareClipboard,
        canTransferFiles,
        canRecordSession,
      });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDismiss = async () => {
    setSubmitting(true);
    try {
      await onReject();
    } finally {
      setSubmitting(false);
    }
  };

  const permissionButtons = [
    {
      key: 'control',
      label: 'Mouse & Keyboard Control',
      active: canControlInput,
      onClick: () => setCanControlInput((v) => !v),
      icon: Keyboard,
    },
    {
      key: 'files',
      label: 'File Transfer',
      active: canTransferFiles,
      onClick: () => setCanTransferFiles((v) => !v),
      icon: FileUp,
    },
    {
      key: 'clipboard',
      label: 'Clipboard Sharing',
      active: canShareClipboard,
      onClick: () => setCanShareClipboard((v) => !v),
      icon: Clipboard,
    },
    {
      key: 'record',
      label: 'Session Recording Consent',
      active: canRecordSession,
      onClick: () => setCanRecordSession((v) => !v),
      icon: Video,
    },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="incoming-approval-title"
    >
      <div className="w-full max-w-3xl bg-white rounded-xl border border-neutral-300 shadow-2xl overflow-hidden">
        {/* Window Title Bar matching Screenshot 2 */}
        <div className="bg-[#383838] text-white px-4 py-2.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5 text-xs font-semibold">
            <span className="inline-flex h-5 w-5 items-center justify-center rounded bg-[#D32027] text-white font-bold">
              V
            </span>
            <span>
              Incoming Support Connection · {requester?.displayName || 'IT Support'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            disabled={submitting}
            className="text-neutral-300 hover:text-white cursor-pointer"
            aria-label="Dismiss incoming request"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Two-Pane Body matching Screenshot 2 */}
        <div className="grid grid-cols-1 md:grid-cols-12">
          {/* Left Pane: Identity + Profile + Permission Toggles + Accept/Dismiss */}
          <div className="md:col-span-5 p-5 border-b md:border-b-0 md:border-r border-neutral-200 flex flex-col justify-between gap-5">
            <div className="space-y-4">
              <div className="flex items-start gap-3.5">
                <div className="h-16 w-16 shrink-0 rounded-lg bg-[#D32027] flex items-center justify-center text-white shadow-xs">
                  <Monitor className="h-8 w-8" />
                </div>
                <div className="min-w-0">
                  <h2
                    id="incoming-approval-title"
                    className="font-display text-sm font-bold text-neutral-900 truncate"
                  >
                    {requester?.displayName || 'Vetiva IT Technician'}
                  </h2>
                  <p className="text-xs text-neutral-500 truncate">
                    {requester?.email || 'support@vetiva.com'}
                  </p>
                  <p className="text-xs text-neutral-700 mt-1.5">
                    would like to view your desk.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 text-xs text-neutral-700">
                <ShieldCheck className="h-4 w-4 text-[#16A34A]" />
                <span>Explicit consent required · Unattended access disabled</span>
              </div>

              <div>
                <label
                  htmlFor="approval-profile"
                  className="block text-xs font-semibold text-neutral-800 mb-1.5"
                >
                  Profile
                </label>
                <select
                  id="approval-profile"
                  value={profileName}
                  onChange={(e) =>
                    applyProfile(
                      e.target.value as 'Default' | 'View Only' | 'Full Support'
                    )
                  }
                  className="w-full h-9 rounded-lg border border-neutral-300 bg-white px-2.5 text-xs font-medium text-neutral-900 focus:outline-none focus:ring-2 focus:ring-[#D32027]/30"
                >
                  <option value="Default">Default (View + Clipboard + Files)</option>
                  <option value="View Only">View Only (Strict)</option>
                  <option value="Full Support">Full Support (Control Enabled)</option>
                </select>
              </div>

              {/* Permission Icon Grid matching Screenshot 2 */}
              <div>
                <p className="text-[11px] font-medium text-neutral-500 mb-2">
                  Toggle individual permissions before accepting:
                </p>
                <div className="grid grid-cols-4 gap-2">
                  {permissionButtons.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={item.onClick}
                        title={`${item.label}: ${item.active ? 'Allowed' : 'Blocked'}`}
                        className={`h-11 rounded-md flex flex-col items-center justify-center border transition-colors cursor-pointer ${
                          item.active
                            ? 'bg-[#3B69B2] text-white border-[#3B69B2]'
                            : 'bg-neutral-100 text-neutral-500 border-neutral-200 hover:bg-neutral-200'
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </button>
                    );
                  })}
                </div>
                <div className="mt-2 grid grid-cols-2 gap-1 text-[11px] text-neutral-600">
                  <span>Control: {canControlInput ? 'Allowed' : 'Off'}</span>
                  <span>Files: {canTransferFiles ? 'Allowed' : 'Off'}</span>
                  <span>Clipboard: {canShareClipboard ? 'Allowed' : 'Off'}</span>
                  <span>Recording: {canRecordSession ? 'Allowed' : 'Off'}</span>
                </div>
              </div>
            </div>

            {/* Accept & Dismiss Actions */}
            <div className="space-y-2 pt-2 border-t border-neutral-200">
              <div className="grid grid-cols-2 gap-2.5">
                <Button
                  type="button"
                  variant="success"
                  onClick={handleAccept}
                  disabled={submitting}
                  className="w-full"
                >
                  <ShieldCheck className="h-4 w-4" />
                  <span>Accept</span>
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleDismiss}
                  disabled={submitting}
                  className="w-full"
                >
                  <span>Dismiss</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Right Pane: Open Chat Log & File Transfer matching Screenshot 2 */}
          <div className="md:col-span-7 p-4 bg-neutral-50/50">
            <SessionChatAndFiles
              sessionId={session.id}
              messages={session.messages}
              files={session.files}
              permissions={session.permissions}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
