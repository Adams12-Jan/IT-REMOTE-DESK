import React, { useRef, useState } from 'react';
import {
  CheckCircle2,
  Download,
  FileUp,
  Lock,
  MessageSquare,
  Send,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { auth } from '../lib/firebase';
import {
  sendSessionMessage,
  uploadSessionFile,
} from '../lib/remoteDeskApi';
import { formatBytes } from '../lib/utils';
import {
  FileTransferRecord,
  RemoteSession,
  SessionMessage,
  SessionPermissions,
} from '../types/remoteDesk';
import { Button, Input } from './ui/primitives';

interface SessionChatAndFilesProps {
  session: RemoteSession;
  messages: SessionMessage[];
  files: FileTransferRecord[];
  permissions: SessionPermissions | null;
  activeTab?: 'chat' | 'files';
  onTabChange?: (tab: 'chat' | 'files') => void;
  onMessageSent?: (msg: SessionMessage) => void;
  onFileUploaded?: (file: FileTransferRecord) => void;
}

export function SessionChatAndFiles({
  session,
  messages,
  files,
  permissions,
  activeTab: controlledTab,
  onTabChange,
  onMessageSent,
  onFileUploaded,
}: SessionChatAndFilesProps) {
  const { apiFetch, profile } = useAuth();
  const [internalTab, setInternalTab] = useState<'chat' | 'files'>('chat');
  const tab = controlledTab ?? internalTab;
  const setTab = onTabChange ?? setInternalTab;

  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || sending || !profile) return;
    setSending(true);
    try {
      const msg = await sendSessionMessage(apiFetch, session.id, trimmed);
      setDraft('');
      onMessageSent?.(msg);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send message.');
    } finally {
      setSending(false);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !profile) return;
    setUploading(true);
    try {
      const recorded = await uploadSessionFile(apiFetch, session.id, file);
      toast.success(`Transferred ${recorded.originalName}`);
      onFileUploaded?.(recorded);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'File transfer failed.');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDownload = async (file: FileTransferRecord) => {
    if (!profile) return;
    try {
      const downloadUrl = `/api/files/${encodeURIComponent(file.storedName)}/download?name=${encodeURIComponent(file.originalName)}`;
      const currentUser = auth.currentUser;
      let token = currentUser ? await currentUser.getIdToken() : '';
      let res = await fetch(downloadUrl, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.status === 401 && currentUser) {
        token = await currentUser.getIdToken(true);
        res = await fetch(downloadUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Download failed.');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = file.originalName;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to download file.');
    }
  };

  return (
    <div className="flex flex-col h-full bg-white border border-neutral-200 rounded-xl overflow-hidden">
      <div className="grid grid-cols-2 border-b border-neutral-200 bg-neutral-100">
        <button
          type="button"
          onClick={() => setTab('chat')}
          className={`py-2.5 px-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            tab === 'chat'
              ? 'bg-[#3B69B2] text-white'
              : 'text-neutral-700 hover:bg-neutral-200/60'
          }`}
        >
          <MessageSquare className="h-3.5 w-3.5" />
          <span>Chat</span>
        </button>
        <button
          type="button"
          onClick={() => setTab('files')}
          className={`py-2.5 px-3 text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
            tab === 'files'
              ? 'bg-[#3B69B2] text-white'
              : 'text-neutral-700 hover:bg-neutral-200/60'
          }`}
        >
          <FileUp className="h-3.5 w-3.5" />
          <span>File Transfer ({files.length})</span>
        </button>
      </div>

      {tab === 'chat' ? (
        <>
          <div className="px-3.5 py-2 border-b border-neutral-100 bg-neutral-50/70">
            <span className="text-xs font-semibold text-neutral-800 underline underline-offset-4">
              Open Chat Log
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-[220px] max-h-[380px]">
            {messages.length === 0 ? (
              <p className="text-xs text-neutral-500 text-center py-8">
                No messages in this support session yet.
              </p>
            ) : (
              messages.map((m) => {
                const isMe = m.senderUid === profile?.uid;
                const time = new Date(m.createdAt).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                });
                if (m.messageType === 'system') {
                  return (
                    <div
                      key={m.id}
                      className="text-xs text-neutral-600 bg-neutral-50 border border-neutral-200/80 rounded-lg px-2.5 py-2"
                    >
                      <div className="flex items-center justify-between text-[11px] text-neutral-400 mb-0.5">
                        <span className="font-semibold text-neutral-700">
                          {m.senderName}
                        </span>
                        <span className="font-mono">{time}</span>
                      </div>
                      <p>{m.body}</p>
                    </div>
                  );
                }

                return (
                  <div
                    key={m.id}
                    className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                  >
                    <div className="flex items-center gap-2 text-[11px] text-neutral-500 mb-0.5">
                      <span className="font-medium text-neutral-700">
                        {m.senderName}
                      </span>
                      <span className="font-mono">{time}</span>
                    </div>
                    <div
                      className={`max-w-[85%] rounded-lg px-3 py-2 text-xs leading-relaxed ${
                        isMe
                          ? 'bg-neutral-900 text-white'
                          : 'bg-neutral-100 text-neutral-900'
                      }`}
                    >
                      {m.body}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form
            onSubmit={handleSend}
            className="p-2.5 border-t border-neutral-200 bg-white flex items-center gap-2"
          >
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Message"
              className="h-9 text-xs"
              maxLength={2000}
            />
            <Button
              type="submit"
              size="icon"
              variant="ghost"
              disabled={sending || !draft.trim()}
              aria-label="Send message"
            >
              <Send className="h-4 w-4 text-neutral-800" />
            </Button>
          </form>
        </>
      ) : (
        <div className="flex-1 flex flex-col justify-between p-3.5 min-h-[260px]">
          <div className="space-y-3">
            {!permissions?.canTransferFiles ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2.5">
                <Lock className="h-4 w-4 shrink-0 mt-0.5 text-amber-700" />
                <div>
                  <p className="font-semibold">File Transfer Permission Required</p>
                  <p className="mt-0.5 text-amber-800">
                    The host employee must explicitly enable File Transfer before files can be exchanged.
                  </p>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-neutral-300 bg-neutral-50 p-3 text-center">
                <input
                  ref={fileInputRef}
                  type="file"
                  onChange={handleUpload}
                  className="hidden"
                  id={`session-file-upload-${session.id}`}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="h-3.5 w-3.5" />
                  <span>{uploading ? 'Scanning & Uploading...' : 'Send Approved File'}</span>
                </Button>
                <p className="mt-1.5 text-[11px] text-neutral-500">
                  Malware-scanned · PDF, Office docs, logs, images, ZIP (max 25 MB)
                </p>
              </div>
            )}

            <div className="space-y-2 max-h-[260px] overflow-y-auto">
              {files.length === 0 ? (
                <p className="text-xs text-neutral-500 text-center py-6">
                  No files transferred in this session.
                </p>
              ) : (
                files.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-neutral-200 px-3 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-neutral-900 truncate">
                        {f.originalName}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-neutral-500 font-mono">
                        <span>{formatBytes(f.sizeBytes)}</span>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1 text-[#15803D]">
                          {f.scanStatus === 'clean' ? (
                            <CheckCircle2 className="h-3 w-3" />
                          ) : (
                            <ShieldAlert className="h-3 w-3 text-[#D32027]" />
                          )}
                          {f.scanStatus}
                        </span>
                      </div>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => handleDownload(f)}
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Save</span>
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
