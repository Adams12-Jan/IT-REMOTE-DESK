import React from 'react';
import { LogOut, ShieldCheck } from 'lucide-react';
import { ConnectionReadyState } from '../context/AuthContext';
import { UserProfile } from '../types/remoteDesk';
import { cn } from '../lib/utils';
import { Button } from './ui/primitives';

export type AppPage =
  | 'landing'
  | 'share'
  | 'join'
  | 'viewer'
  | 'dashboard'
  | 'history'
  | 'users'
  | 'settings';

interface HeaderProps {
  currentPage: AppPage;
  onNavigate: (page: AppPage) => void;
  profile: UserProfile | null;
  connectionState: ConnectionReadyState;
  onSignIn: () => void;
  onSignOut: () => void;
  hasActiveSession: boolean;
  isHostSession?: boolean;
}

export function Header({
  currentPage,
  onNavigate,
  profile,
  connectionState,
  onSignIn,
  onSignOut,
  hasActiveSession,
  isHostSession = false,
}: HeaderProps) {
  const statusDisplay = (() => {
    if (connectionState === 'ready') {
      return {
        label: 'Ready',
        dotClass: 'bg-[#16A34A]',
        textClass: 'text-[#15803D]',
      };
    }
    if (connectionState === 'connecting') {
      return {
        label: 'Connecting',
        dotClass: 'bg-amber-500',
        textClass: 'text-amber-700',
      };
    }
    if (connectionState === 'disconnected') {
      return {
        label: 'Reconnecting',
        dotClass: 'bg-amber-600',
        textClass: 'text-amber-700',
      };
    }
    return {
      label: 'Sign in required',
      dotClass: 'bg-neutral-400',
      textClass: 'text-neutral-600',
    };
  })();

  const navItems: Array<{ id: AppPage; label: string; visible: boolean }> = [
    { id: 'landing', label: 'Remote Desk', visible: true },
    {
      id: 'dashboard',
      label: 'Dashboard',
      visible:
        profile?.roleSlug === 'admin' || profile?.roleSlug === 'technician',
    },
    { id: 'history', label: 'History', visible: Boolean(profile) },
    { id: 'users', label: 'Users', visible: profile?.roleSlug === 'admin' },
    { id: 'settings', label: 'Settings', visible: profile?.roleSlug === 'admin' },
  ];

  return (
    <header className="sticky top-0 z-30 bg-white border-b border-[#E5E7EB]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-6">
        {/* Zone 1: Vetiva Logo + Application Title + Connection Status */}
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('landing')}
            className="flex items-center gap-3 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#D32027]/40 rounded-lg pr-1"
          >
            <img
              src="/assets/aistudio/aee8f29a-8fc3-4160-b51e-cc82b16a854e_85c7cccb.png"
              alt="Vetiva Capital Management Limited"
              referrerPolicy="no-referrer"
              className="h-9 w-9 object-contain shrink-0"
            />
            <div className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="font-display text-lg font-bold tracking-tight text-neutral-900">
                Virtual Remote Desk
              </span>
              <span className="hidden sm:inline text-xs font-medium text-neutral-500">
                Vetiva
              </span>
            </div>
          </button>

          <div
            className="hidden md:flex items-center gap-1.5 pl-3 ml-1 border-l border-neutral-200 whitespace-nowrap"
            title="Real-time signaling connection state"
          >
            <span
              className={cn('h-2 w-2 rounded-full shrink-0', statusDisplay.dotClass)}
            />
            <span className={cn('text-xs font-semibold', statusDisplay.textClass)}>
              {statusDisplay.label}
            </span>
          </div>
        </div>

        {/* Zone 2: Clean Single-Line Navigation Links */}
        <nav className="hidden lg:flex items-center gap-6 text-sm font-medium">
          {navItems
            .filter((item) => item.visible)
            .map((item) => {
              const active =
                currentPage === item.id ||
                (item.id === 'landing' &&
                  (currentPage === 'share' ||
                    currentPage === 'join' ||
                    currentPage === 'viewer'));
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => onNavigate(item.id)}
                  className={cn(
                    'py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer',
                    active
                      ? 'border-[#D32027] text-neutral-900 font-semibold'
                      : 'border-transparent text-neutral-600 hover:text-neutral-900'
                  )}
                >
                  {item.label}
                </button>
              );
            })}
        </nav>

        {/* Zone 3: Account / Primary Auth Action */}
        <div className="flex items-center gap-3 shrink-0">
          {hasActiveSession && currentPage !== 'viewer' && currentPage !== 'share' && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onNavigate(isHostSession ? 'share' : 'viewer')}
              className="hidden sm:inline-flex"
            >
              Return to Session
            </Button>
          )}
          {profile ? (
            <div className="flex items-center gap-3">
              <div className="hidden sm:block text-right leading-tight">
                <div className="text-xs font-semibold text-neutral-900 max-w-[160px] truncate">
                  {profile.displayName}
                </div>
                <div className="text-[11px] text-neutral-500 capitalize">
                  {profile.roleSlug === 'admin'
                    ? 'Administrator'
                    : profile.roleSlug === 'technician'
                      ? 'IT Support'
                      : 'Employee'}
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={onSignOut}
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Sign Out</span>
              </Button>
            </div>
          ) : (
            <Button variant="primary" size="sm" onClick={onSignIn}>
              <ShieldCheck className="h-4 w-4" />
              <span>Corporate Sign In</span>
            </Button>
          )}
        </div>
      </div>

      {/* Responsive Mobile Navigation Strip */}
      {profile && (
        <div className="lg:hidden border-t border-neutral-200 px-4 py-2 flex items-center gap-4 overflow-x-auto text-xs font-medium">
          {navItems
            .filter((item) => item.visible)
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onNavigate(item.id)}
                className={cn(
                  'whitespace-nowrap shrink-0 py-1 px-2 rounded-md',
                  currentPage === item.id
                    ? 'bg-neutral-900 text-white'
                    : 'text-neutral-600 hover:bg-neutral-100'
                )}
              >
                {item.label}
              </button>
            ))}
        </div>
      )}
    </header>
  );
}
