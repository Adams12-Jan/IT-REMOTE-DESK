import React, { useCallback, useEffect, useState } from 'react';
import { Search, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../context/AuthContext';
import { formatDateTime } from '../lib/utils';
import { UserProfile, UserRole } from '../types/remoteDesk';
import { Button, Card, Input, Switch } from '../components/ui/primitives';

export function UsersPage() {
  const { apiFetch, profile } = useAuth();
  const [usersList, setUsersList] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newDept, setNewDept] = useState('IT Support');
  const [newRole, setNewRole] = useState<UserRole>('technician');
  const [creating, setCreating] = useState(false);

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const q = search.trim() ? `?search=${encodeURIComponent(search.trim())}` : '';
      const res = await apiFetch<{ users: UserProfile[] }>(`/api/users${q}`);
      setUsersList(res.users);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, [apiFetch, search]);

  useEffect(() => {
    void loadUsers();
  }, [loadUsers]);

  const handleRoleChange = async (userId: number, roleSlug: UserRole) => {
    try {
      await apiFetch(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ roleSlug }),
      });
      toast.success('User role updated.');
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to update role.');
    }
  };

  const handleToggleActive = async (userId: number, isActive: boolean) => {
    try {
      await apiFetch(`/api/users/${userId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isActive }),
      });
      toast.success(isActive ? 'Account activated.' : 'Account deactivated.');
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Unable to update status.');
    }
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEmail.trim() || !newName.trim()) return;
    setCreating(true);
    try {
      await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({
          email: newEmail.trim().toLowerCase(),
          displayName: newName.trim(),
          department: newDept.trim() || 'Vetiva Operations',
          roleSlug: newRole,
        }),
      });
      toast.success('Corporate user pre-registered.');
      setNewEmail('');
      setNewName('');
      await loadUsers();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add user.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-neutral-900">
          User & Role Management
        </h1>
        <p className="text-sm text-neutral-600">
          Provision IT Support Technicians, Administrators, and Vetiva employee access controls.
        </p>
      </div>

      {/* Add / Pre-register Vetiva Staff Account */}
      <Card className="p-5">
        <h2 className="font-display text-sm font-bold text-neutral-900 mb-3 flex items-center gap-2">
          <UserPlus className="h-4 w-4 text-[#D32027]" />
          <span>Register Corporate Account</span>
        </h2>
        <form
          onSubmit={handleCreateUser}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end"
        >
          <div>
            <label className="block text-[11px] font-semibold text-neutral-600 mb-1">
              Full Name
            </label>
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Chidi Okafor"
              required
              className="h-9 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-neutral-600 mb-1">
              Corporate Email
            </label>
            <Input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              placeholder="name@vetiva.com"
              required
              className="h-9 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-neutral-600 mb-1">
              Department
            </label>
            <Input
              value={newDept}
              onChange={(e) => setNewDept(e.target.value)}
              placeholder="IT Support"
              className="h-9 text-xs"
            />
          </div>
          <div>
            <label className="block text-[11px] font-semibold text-neutral-600 mb-1">
              Role
            </label>
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="w-full h-9 rounded-lg border border-neutral-300 bg-white px-2.5 text-xs text-neutral-900"
            >
              <option value="technician">IT Support Technician</option>
              <option value="employee">End User / Employee</option>
              <option value="admin">Administrator</option>
            </select>
          </div>
          <Button type="submit" variant="primary" size="sm" disabled={creating} className="h-9">
            {creating ? 'Registering...' : 'Add User'}
          </Button>
        </form>
      </Card>

      {/* Search & Directory Table */}
      <Card className="overflow-hidden">
        <div className="p-4 border-b border-neutral-200 flex items-center justify-between gap-4">
          <div className="relative w-full max-w-sm">
            <Search className="h-3.5 w-3.5 text-neutral-400 absolute left-3 top-3" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search corporate directory..."
              className="pl-8 h-9 text-xs"
            />
          </div>
          <span className="text-xs text-neutral-500 font-mono">
            {usersList.length} accounts
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-neutral-50 border-b border-neutral-200 text-neutral-600">
              <tr>
                <th className="py-3 px-4 font-semibold">User</th>
                <th className="py-3 px-4 font-semibold">Department</th>
                <th className="py-3 px-4 font-semibold">Role</th>
                <th className="py-3 px-4 font-semibold">Presence</th>
                <th className="py-3 px-4 font-semibold">Last Active</th>
                <th className="py-3 px-4 font-semibold text-right">Enabled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-8 text-center text-neutral-500">
                    Loading directory...
                  </td>
                </tr>
              ) : (
                usersList.map((u) => (
                  <tr key={u.id} className="hover:bg-neutral-50">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-neutral-900">
                        {u.displayName}
                      </div>
                      <div className="text-[11px] text-neutral-500">{u.email}</div>
                    </td>
                    <td className="py-3 px-4 text-neutral-700">{u.department}</td>
                    <td className="py-3 px-4">
                      <select
                        value={u.roleSlug}
                        disabled={u.id === profile?.id}
                        onChange={(e) =>
                          handleRoleChange(u.id, e.target.value as UserRole)
                        }
                        className="h-8 rounded-md border border-neutral-300 bg-white px-2 text-xs text-neutral-900 disabled:opacity-60"
                      >
                        <option value="admin">Administrator</option>
                        <option value="technician">IT Support Technician</option>
                        <option value="employee">End User / Employee</option>
                      </select>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={
                          u.isOnline
                            ? 'text-[#15803D] font-medium'
                            : 'text-neutral-500'
                        }
                      >
                        {u.isOnline ? 'Online' : 'Offline'}
                      </span>
                    </td>
                    <td className="py-3 px-4 font-mono text-neutral-500">
                      {formatDateTime(u.lastSeenAt)}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex justify-end">
                        <Switch
                          ariaLabel={`Toggle active state for ${u.displayName}`}
                          checked={u.isActive}
                          disabled={u.id === profile?.id}
                          onCheckedChange={(val) => handleToggleActive(u.id, val)}
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </main>
  );
}
