import React, { useCallback, useEffect, useState } from 'react';
import { Laptop, Save, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/utils';
import { AppSettingsRecord, AuditLogRecord } from '../types/remoteDesk';
import { Button, Card, Input, Switch } from '../components/ui/primitives';

export function SettingsPage() {
  const { apiFetch } = useAuth();
  const [settings, setSettings] = useState<AppSettingsRecord | null>(null);
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [extensionsInput, setExtensionsInput] = useState('');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, lRes] = await Promise.all([
        apiFetch<{ settings: AppSettingsRecord }>('/api/settings'),
        apiFetch<{ logs: AuditLogRecord[] }>('/api/audit-logs'),
      ]);
      setSettings(sRes.settings);
      setExtensionsInput(sRes.settings.allowedFileExtensions.join(', '));
      setLogs(lRes.logs);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Unable to load security settings.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    try {
      const parsedExts = extensionsInput
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.startsWith('.') && s.length >= 2);

      const res = await apiFetch<{ settings: AppSettingsRecord }>('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          sessionExpiryMinutes: Number(settings.sessionExpiryMinutes),
          maxFailedAttempts: Number(settings.maxFailedAttempts),
          maxFileSizeMb: Number(settings.maxFileSizeMb),
          requireExplicitControlConsent: settings.requireExplicitControlConsent,
          allowSessionRecording: settings.allowSessionRecording,
          enforceVetivaDomainOnly: settings.enforceVetivaDomainOnly,
          allowedFileExtensions: parsedExts,
        }),
      });
      setSettings(res.settings);
      toast.success('Security policies saved to PostgreSQL.');
      await loadData();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to save security policies.'
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8">
        <div className="h-64 bg-white rounded-xl border border-neutral-200 animate-pulse" />
      </main>
    );
  }

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-neutral-900">
          Security & Application Settings
        </h1>
        <p className="text-sm text-neutral-600">
          Configure session timeouts, brute-force lockouts, file transfer allowlists, and inspect the audit trail.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <Card className="lg:col-span-6 p-6">
          <form onSubmit={handleSave} className="space-y-5">
            <div className="flex items-center gap-2 border-b border-neutral-200 pb-3">
              <ShieldCheck className="h-5 w-5 text-[#D32027]" />
              <h2 className="font-display text-base font-bold text-neutral-900">
                Corporate Session Security Policy
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Session Expiry (min)
                </label>
                <Input
                  type="number"
                  min={5}
                  max={480}
                  value={settings.sessionExpiryMinutes}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      sessionExpiryMinutes: Number(e.target.value),
                    })
                  }
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Lockout Attempts
                </label>
                <Input
                  type="number"
                  min={2}
                  max={20}
                  value={settings.maxFailedAttempts}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxFailedAttempts: Number(e.target.value),
                    })
                  }
                  className="font-mono"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-neutral-700 mb-1">
                  Max File Size (MB)
                </label>
                <Input
                  type="number"
                  min={1}
                  max={50}
                  value={settings.maxFileSizeMb}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      maxFileSizeMb: Number(e.target.value),
                    })
                  }
                  className="font-mono"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-neutral-700 mb-1">
                Approved File Extensions
              </label>
              <Input
                value={extensionsInput}
                onChange={(e) => setExtensionsInput(e.target.value)}
                className="font-mono text-xs"
              />
              <p className="mt-1 text-[11px] text-neutral-500">
                Executables (.exe, .bat, .ps1, .sh, .dll) are always blocked at the scanner layer.
              </p>
            </div>

            <div className="space-y-3 pt-2 border-t border-neutral-100">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-neutral-900">
                    Require Explicit Remote Control Consent
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Always default keyboard & mouse control to OFF until approved
                  </div>
                </div>
                <Switch
                  ariaLabel="Require explicit remote control consent"
                  checked={settings.requireExplicitControlConsent}
                  onCheckedChange={(v) =>
                    setSettings({ ...settings, requireExplicitControlConsent: v })
                  }
                />
              </div>

              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-semibold text-neutral-900">
                    Allow Consent-Gated Session Recording
                  </div>
                  <div className="text-[11px] text-neutral-500">
                    Permits technicians to record only if the employee activates consent
                  </div>
                </div>
                <Switch
                  ariaLabel="Allow session recording"
                  checked={settings.allowSessionRecording}
                  onCheckedChange={(v) =>
                    setSettings({ ...settings, allowSessionRecording: v })
                  }
                />
              </div>
            </div>

            <Button type="submit" variant="primary" disabled={saving}>
              <Save className="h-4 w-4" />
              <span>{saving ? 'Saving Policy...' : 'Save Security Settings'}</span>
            </Button>
          </form>
        </Card>

        {/* Native Desktop Agent Companion Architecture Card */}
        <Card className="lg:col-span-6 p-6 space-y-4">
          <div className="flex items-center gap-2 border-b border-neutral-200 pb-3">
            <Laptop className="h-5 w-5 text-[#9C844B]" />
            <h2 className="font-display text-base font-bold text-neutral-900">
              Native OS Remote Control Agent (Rust + Tauri)
            </h2>
          </div>

          <p className="text-xs text-neutral-600 leading-relaxed">
            Browser sandboxes restrict OS-level mouse and keyboard injection. For full unattended-free workstation control across Windows, macOS, and Linux, deploy the companion Vetiva Desktop Agent located in{' '}
            <code className="font-mono bg-neutral-100 px-1.5 py-0.5 rounded">
              /desktop-agent
            </code>
            .
          </p>

          <div className="rounded-lg border border-neutral-200 bg-neutral-50 p-4 space-y-2 text-xs text-neutral-700">
            <div className="font-semibold text-neutral-900">
              Enforced Native Agent Safeguards
            </div>
            <ul className="list-disc pl-4 space-y-1">
              <li>Explicit OS accessibility & screen-recording prompt verification.</li>
              <li>Mutual TLS / Bearer token authentication with the Vetiva signaling server.</li>
              <li>Hardware Emergency-Stop hotkey (Ctrl+Alt+Esc) revokes input hooks immediately.</li>
              <li>Ed25519 signed Tauri updater manifest for corporate endpoint updates.</li>
            </ul>
          </div>
        </Card>
      </div>

      {/* Audit Trail Table */}
      <Card className="overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="font-display text-sm font-bold text-neutral-900">
            Security Audit Trail ({logs.length})
          </h2>
        </div>
        <div className="overflow-x-auto max-h-[380px]">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600 sticky top-0">
              <tr>
                <th className="py-2.5 px-4 font-semibold">Timestamp</th>
                <th className="py-2.5 px-4 font-semibold">Action</th>
                <th className="py-2.5 px-4 font-semibold">Severity</th>
                <th className="py-2.5 px-4 font-semibold">Actor</th>
                <th className="py-2.5 px-4 font-semibold">Session</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {logs.map((log) => (
                <tr key={log.id} className="hover:bg-neutral-50">
                  <td className="py-2.5 px-4 font-mono text-neutral-500 whitespace-nowrap">
                    {formatDateTime(log.createdAt)}
                  </td>
                  <td className="py-2.5 px-4 font-mono font-semibold text-neutral-900">
                    {log.action}
                  </td>
                  <td className="py-2.5 px-4 capitalize">
                    <span
                      className={
                        log.severity === 'critical'
                          ? 'text-[#D32027] font-semibold'
                          : log.severity === 'warning'
                            ? 'text-amber-700 font-medium'
                            : 'text-neutral-600'
                      }
                    >
                      {log.severity}
                    </span>
                  </td>
                  <td className="py-2.5 px-4 text-neutral-700">
                    {log.actorEmail || 'System'}
                  </td>
                  <td className="py-2.5 px-4 font-mono text-neutral-600">
                    {log.sessionId ? `#${log.sessionId}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
