import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle2,
  Clock,
  RefreshCw,
  Search,
  ShieldAlert,
  Users,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import {
  disconnectSession,
  fetchDashboardData,
} from '../lib/remoteDeskApi';
import {
  formatDateTime,
  formatDuration,
  formatSessionCode,
} from '../lib/utils';
import { DashboardPayload } from '../types/remoteDesk';
import { Button, Card, Input } from '../components/ui/primitives';

interface DashboardPageProps {
  onOpenSession: (sessionId: string, mode: 'host' | 'viewer') => Promise<void>;
}

export function DashboardPage({ onOpenSession }: DashboardPageProps) {
  const { apiFetch, profile, socket } = useAuth();
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [techFilter, setTechFilter] = useState<string>('all');
  const [employeeQuery, setEmployeeQuery] = useState<string>('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const loadDashboard = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetchDashboardData(apiFetch);
      setData(res);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load dashboard.'
      );
    } finally {
      setLoading(false);
    }
  }, [apiFetch, profile]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => {
      void loadDashboard();
    };
    socket.on('presence:technician-update', refresh);
    socket.on('session:incoming-request', refresh);
    socket.on('session:approved', refresh);
    socket.on('session:disconnected', refresh);
    return () => {
      socket.off('presence:technician-update', refresh);
      socket.off('session:incoming-request', refresh);
      socket.off('session:approved', refresh);
      socket.off('session:disconnected', refresh);
    };
  }, [loadDashboard, socket]);

  const filteredSessions = useMemo(() => {
    if (!data) return [];
    return data.sessions.filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false;
      if (
        techFilter !== 'all' &&
        (s.technicianUid ?? '') !== techFilter
      ) {
        return false;
      }
      if (employeeQuery.trim()) {
        const q = employeeQuery.trim().toLowerCase();
        const matchesHost =
          s.host?.displayName.toLowerCase().includes(q) ||
          s.host?.email.toLowerCase().includes(q) ||
          s.sessionCode.includes(q.replace(/\s+/g, ''));
        if (!matchesHost) return false;
      }
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (new Date(s.createdAt) < from) return false;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        to.setHours(23, 59, 59, 999);
        if (new Date(s.createdAt) > to) return false;
      }
      return true;
    });
  }, [data, dateFrom, dateTo, employeeQuery, statusFilter, techFilter]);

  const handleForceDisconnect = async (sessionId: string) => {
    if (!profile) return;
    try {
      await disconnectSession(
        apiFetch,
        sessionId,
        'Terminated from IT Support Dashboard'
      );
      toast.success('Session terminated.');
      await loadDashboard();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Unable to terminate session.'
      );
    }
  };

  if (loading && !data) {
    return (
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        <div className="h-8 w-64 bg-neutral-200 rounded animate-pulse" />
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-24 bg-white rounded-xl border border-neutral-200 animate-pulse"
            />
          ))}
        </div>
        <div className="h-72 bg-white rounded-xl border border-neutral-200 animate-pulse" />
      </main>
    );
  }

  if (error) {
    return (
      <main className="max-w-4xl mx-auto px-4 sm:px-6 py-12">
        <Card className="p-6 text-center space-y-3">
          <ShieldAlert className="h-8 w-8 text-[#D32027] mx-auto" />
          <h2 className="font-display text-base font-bold text-neutral-900">
            Dashboard Unavailable
          </h2>
          <p className="text-sm text-neutral-600">{error}</p>
          <Button variant="outline" onClick={loadDashboard}>
            Retry
          </Button>
        </Card>
      </main>
    );
  }

  if (!data) return null;

  const kpis = [
    { label: 'Total Remote Sessions', value: data.metrics.totalSessions },
    { label: 'Active Sessions', value: data.metrics.activeSessions },
    { label: 'Completed Sessions', value: data.metrics.completedSessions },
    { label: 'Pending Requests', value: data.metrics.pendingRequests },
    {
      label: 'Online IT Technicians',
      value: data.metrics.onlineTechniciansCount,
    },
  ];

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-neutral-900">
            IT Support Operations Dashboard
          </h1>
          <p className="text-sm text-neutral-600">
            Real-time remote support telemetry, technician availability, and session governance.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={loadDashboard}>
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Refresh</span>
        </Button>
      </div>

      {/* 5-Column KPI Strip */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label} className="p-4">
            <div className="text-xs font-medium text-neutral-500">
              {kpi.label}
            </div>
            <div className="mt-2 font-mono text-2xl font-bold text-neutral-900 tabular-nums">
              {kpi.value}
            </div>
          </Card>
        ))}
      </div>

      {/* Filters Toolbar */}
      <Card className="p-4 flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]">
          <label
            htmlFor="dash-emp-search"
            className="block text-[11px] font-semibold text-neutral-600 mb-1"
          >
            Employee or Session ID
          </label>
          <div className="relative">
            <Search className="h-3.5 w-3.5 text-neutral-400 absolute left-3 top-3" />
            <Input
              id="dash-emp-search"
              value={employeeQuery}
              onChange={(e) => setEmployeeQuery(e.target.value)}
              placeholder="Search name, email, or code..."
              className="pl-8 h-9 text-xs"
            />
          </div>
        </div>

        <div className="w-44">
          <label
            htmlFor="dash-tech-filter"
            className="block text-[11px] font-semibold text-neutral-600 mb-1"
          >
            Technician
          </label>
          <select
            id="dash-tech-filter"
            value={techFilter}
            onChange={(e) => setTechFilter(e.target.value)}
            className="w-full h-9 rounded-lg border border-neutral-300 bg-white px-2.5 text-xs text-neutral-900"
          >
            <option value="all">All Technicians</option>
            {data.technicians.map((t) => (
              <option key={t.uid} value={t.uid}>
                {t.displayName}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label
            htmlFor="dash-date-from"
            className="block text-[11px] font-semibold text-neutral-600 mb-1"
          >
            From
          </label>
          <Input
            id="dash-date-from"
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-9 text-xs w-36"
          />
        </div>

        <div>
          <label
            htmlFor="dash-date-to"
            className="block text-[11px] font-semibold text-neutral-600 mb-1"
          >
            To
          </label>
          <Input
            id="dash-date-to"
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-9 text-xs w-36"
          />
        </div>

        {/* Interactive Segmented Status Filter */}
        <div className="flex items-center gap-1 p-1 bg-neutral-100 rounded-lg">
          {[
            { id: 'all', label: 'All' },
            { id: 'active', label: 'Active' },
            { id: 'pending_approval', label: 'Pending' },
            { id: 'ended', label: 'Ended' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-white text-neutral-900 shadow-xs'
                  : 'text-neutral-600 hover:text-neutral-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Sessions Table (8 cols) */}
        <Card className="lg:col-span-8 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-neutral-200 flex items-center justify-between">
            <h2 className="font-display text-sm font-bold text-neutral-900">
              Remote Support Sessions ({filteredSessions.length})
            </h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
                <tr>
                  <th className="py-2.5 px-4 font-semibold">Session ID</th>
                  <th className="py-2.5 px-4 font-semibold">Employee</th>
                  <th className="py-2.5 px-4 font-semibold">Technician</th>
                  <th className="py-2.5 px-4 font-semibold">Status</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Duration</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-200">
                {filteredSessions.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="py-10 px-4 text-center text-neutral-500"
                    >
                      No sessions matched the active filters.
                    </td>
                  </tr>
                ) : (
                  filteredSessions.map((s) => {
                    const isOpen =
                      s.status === 'active' ||
                      s.status === 'pending_approval' ||
                      s.status === 'waiting';
                    return (
                      <tr key={s.id} className="hover:bg-neutral-50/80">
                        <td className="py-3 px-4 font-mono font-semibold text-neutral-900 whitespace-nowrap">
                          {formatSessionCode(s.sessionCode)}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-medium text-neutral-900">
                            {s.host?.displayName || 'Employee'}
                          </div>
                          <div className="text-[11px] text-neutral-500">
                            {s.issueSummary}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-neutral-700">
                          {s.technician?.displayName || 'Unassigned'}
                        </td>
                        <td className="py-3 px-4 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center gap-1 font-medium capitalize ${
                              s.status === 'active'
                                ? 'text-[#15803D]'
                                : s.status === 'pending_approval'
                                  ? 'text-amber-700'
                                  : s.status === 'ended'
                                    ? 'text-neutral-600'
                                    : 'text-neutral-700'
                            }`}
                          >
                            {s.status === 'active' ? (
                              <Activity className="h-3.5 w-3.5" />
                            ) : s.status === 'ended' ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Clock className="h-3.5 w-3.5" />
                            )}
                            {s.status.replace('_', ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-mono text-neutral-700">
                          {formatDuration(s.startedAt, s.endedAt)}
                        </td>
                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <div className="inline-flex items-center gap-2">
                            {isOpen &&
                              (s.hostUid === profile?.uid ||
                                s.technicianUid === profile?.uid) && (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  onClick={() =>
                                    onOpenSession(
                                      s.id,
                                      s.hostUid === profile?.uid
                                        ? 'host'
                                        : 'viewer'
                                    )
                                  }
                                >
                                  Open
                                </Button>
                              )}
                            {isOpen && (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                onClick={() => handleForceDisconnect(s.id)}
                                className="text-[#D32027] hover:text-[#B81920]"
                                title="End session"
                              >
                                <XCircle className="h-3.5 w-3.5" />
                                <span>End</span>
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Right Sidebar: Online Technicians + Recent Activities (4 cols) */}
        <div className="lg:col-span-4 space-y-5">
          <Card className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-display text-sm font-bold text-neutral-900 flex items-center gap-2">
                <Users className="h-4 w-4 text-neutral-600" />
                <span>Online IT Technicians</span>
              </h2>
              <span className="font-mono text-xs font-semibold text-[#15803D]">
                {data.onlineTechnicians.length} online
              </span>
            </div>
            <div className="space-y-2.5">
              {data.onlineTechnicians.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  No technicians currently online.
                </p>
              ) : (
                data.onlineTechnicians.map((tech) => (
                  <div
                    key={tech.uid}
                    className="flex items-center justify-between text-xs py-1.5 border-b border-neutral-100 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="font-semibold text-neutral-900 truncate">
                        {tech.displayName}
                      </div>
                      <div className="text-[11px] text-neutral-500 truncate">
                        {tech.department}
                      </div>
                    </div>
                    <span className="text-[11px] font-medium text-[#15803D] shrink-0">
                      Available
                    </span>
                  </div>
                ))
              )}
            </div>
          </Card>

          <Card className="p-4">
            <h2 className="font-display text-sm font-bold text-neutral-900 mb-3">
              Recent Support Activities
            </h2>
            <div className="space-y-2.5 max-h-[340px] overflow-y-auto pr-1">
              {data.recentActivities.length === 0 ? (
                <p className="text-xs text-neutral-500">
                  No activity logged yet.
                </p>
              ) : (
                data.recentActivities.map((act) => (
                  <div
                    key={act.id}
                    className="text-xs pb-2.5 border-b border-neutral-100 last:border-0"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono font-semibold text-neutral-800">
                        {act.action}
                      </span>
                      <span className="font-mono text-[11px] text-neutral-400">
                        {formatDateTime(act.createdAt)}
                      </span>
                    </div>
                    <div className="text-[11px] text-neutral-500 mt-0.5 truncate">
                      {act.actorEmail || 'System'}
                      {act.sessionId ? ` · Session #${act.sessionId}` : ''}
                    </div>
                  </div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
    </main>
  );
}
