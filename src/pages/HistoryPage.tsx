import React, { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import {
  fetchSessionHistory,
  getSessionByIdApi,
} from '../lib/remoteDeskApi';
import {
  formatDateTime,
  formatDuration,
  formatSessionCode,
} from '../lib/utils';
import { RemoteSession } from '../types/remoteDesk';
import { Button, Card, Input } from '../components/ui/primitives';

export function HistoryPage() {
  const { apiFetch, profile } = useAuth();
  const [sessions, setSessions] = useState<RemoteSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<RemoteSession | null>(
    null
  );

  const loadHistory = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    try {
      const list = await fetchSessionHistory(apiFetch, { status, search });
      setSessions(list);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Unable to load session history.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch, profile, search, status]);

  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);

  const toggleExpand = async (sessionId: string) => {
    if (!profile) return;
    if (expandedId === sessionId) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(sessionId);
    try {
      const hydrated = await getSessionByIdApi(apiFetch, sessionId);
      setExpandedDetail(hydrated);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Unable to load session details.'
      );
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-neutral-900">
            Session History & Audit Records
          </h1>
          <p className="text-sm text-neutral-600">
            Complete record of Vetiva remote support sessions, participants, and durations.
          </p>
        </div>
      </div>

      <Card className="p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="relative flex-1 min-w-[240px]">
          <Search className="h-4 w-4 text-neutral-400 absolute left-3 top-3" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter by session code, employee, technician, or topic..."
            className="pl-9 h-10 text-sm"
          />
        </div>

        <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg">
          {['all', 'active', 'ended', 'expired'].map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatus(st)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize cursor-pointer ${
                status === st
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {st}
            </button>
          ))}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="py-3 px-4 font-semibold">Session ID</th>
                <th className="py-3 px-4 font-semibold">Host Employee</th>
                <th className="py-3 px-4 font-semibold">IT Technician</th>
                <th className="py-3 px-4 font-semibold">Topic</th>
                <th className="py-3 px-4 font-semibold">Status</th>
                <th className="py-3 px-4 font-semibold text-right">Duration</th>
                <th className="py-3 px-4 font-semibold text-right">Created</th>
                <th className="py-3 px-4 font-semibold text-right">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-neutral-500">
                    Loading session history...
                  </td>
                </tr>
              ) : sessions.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-neutral-500">
                    No remote support sessions found.
                  </td>
                </tr>
              ) : (
                sessions.map((s) => (
                  <React.Fragment key={s.id}>
                    <tr className="hover:bg-neutral-50">
                      <td className="py-3 px-4 font-mono font-semibold text-neutral-900 whitespace-nowrap">
                        {formatSessionCode(s.sessionCode)}
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-neutral-900">
                          {s.host?.displayName || '—'}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {s.host?.email}
                        </div>
                      </td>
                      <td className="py-3 px-4">
                        <div className="font-medium text-neutral-900">
                          {s.technician?.displayName || 'Unassigned'}
                        </div>
                        <div className="text-[11px] text-neutral-500">
                          {s.technician?.email || ''}
                        </div>
                      </td>
                      <td className="py-3 px-4 text-neutral-700 max-w-[200px] truncate">
                        {s.issueSummary}
                      </td>
                      <td className="py-3 px-4 capitalize font-medium text-neutral-800">
                        {s.status.replace('_', ' ')}
                      </td>
                      <td className="py-3 px-4 text-right font-mono">
                        {formatDuration(s.startedAt, s.endedAt)}
                      </td>
                      <td className="py-3 px-4 text-right font-mono text-neutral-500">
                        {formatDateTime(s.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => toggleExpand(s.id)}
                        >
                          {expandedId === s.id ? (
                            <ChevronUp className="h-4 w-4" />
                          ) : (
                            <ChevronDown className="h-4 w-4" />
                          )}
                        </Button>
                      </td>
                    </tr>
                    {expandedId === s.id && expandedDetail && (
                      <tr className="bg-neutral-50">
                        <td colSpan={8} className="p-4 border-t border-neutral-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
                            <div>
                              <h3 className="font-semibold text-neutral-900 mb-2">
                                Session Telemetry & Closure
                              </h3>
                              <p className="text-neutral-600">
                                Quality: {expandedDetail.connectionQuality} · Avg Latency:{' '}
                                <span className="font-mono">
                                  {expandedDetail.latencyMs} ms
                                </span>
                              </p>
                              <p className="text-neutral-600 mt-1">
                                End Reason: {expandedDetail.endReason || 'Active / Open'}
                              </p>
                            </div>
                            <div>
                              <h3 className="font-semibold text-neutral-900 mb-2">
                                Chat & Event Transcript ({expandedDetail.messages.length})
                              </h3>
                              <div className="max-h-36 overflow-y-auto space-y-1.5 bg-white border border-neutral-200 rounded-lg p-2.5">
                                {expandedDetail.messages.map((m) => (
                                  <div key={m.id} className="text-[11px]">
                                    <span className="font-semibold text-neutral-800">
                                      {m.senderName}:{' '}
                                    </span>
                                    <span className="text-neutral-600">{m.body}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
