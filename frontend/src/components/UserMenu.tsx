// New top-right "small settings menu" (Modification Request 2026-09-15, Dashboard section
// requirement #1): "show logged in details with a user icon on right top ... option to
// logout change password, user profile as a new popup". Replaces the old always-visible
// bottom-of-sidebar name/role/"Log out" block in AppLayout.tsx - that block is gone, this is
// its one replacement, reachable from every page since AppLayout renders it once, outside
// the <Outlet/>.
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { AxiosError } from 'axios';
import { useAuth } from '../lib/auth';
import { changePassword } from '../lib/authApi';
import { Modal } from './Modal';
import { Field, inputClass } from './Field';
import { ErrorNotice } from './DataTable';

type PopupTab = 'profile' | 'password';

export function UserMenu() {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [popupTab, setPopupTab] = useState<PopupTab | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function onClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [menuOpen]);

  if (!user) return null;

  const initial = (user.firstName?.[0] ?? user.email[0] ?? '?').toUpperCase();

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-100"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold text-white">
          {initial}
        </span>
        <span className="hidden min-w-0 sm:block">
          <span className="block truncate text-sm font-medium text-slate-800">
            {user.firstName} {user.lastName}
          </span>
          <span className="block truncate text-xs text-slate-400">{user.role.displayName}</span>
        </span>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 shrink-0 text-slate-400">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 10.94l3.71-3.71a.75.75 0 1 1 1.06 1.06l-4.24 4.24a.75.75 0 0 1-1.06 0L5.21 8.29a.75.75 0 0 1 .02-1.08z" clipRule="evenodd" />
        </svg>
      </button>

      {menuOpen && (
        <div className="absolute right-0 z-40 mt-1 w-48 rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setPopupTab('profile');
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            My Profile
          </button>
          <button
            type="button"
            onClick={() => {
              setPopupTab('password');
              setMenuOpen(false);
            }}
            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          >
            Change Password
          </button>
          <div className="my-1 border-t border-slate-100" />
          <button
            type="button"
            onClick={() => void logout()}
            className="block w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
          >
            Log out
          </button>
        </div>
      )}

      {/* Keyed on popupTab so opening from a different menu item (or reopening after a
          close) starts a fresh instance defaulted to that tab, instead of syncing an
          internal activeTab state to a prop change via an effect. */}
      <UserSettingsModal key={popupTab ?? 'closed'} tab={popupTab} onClose={() => setPopupTab(null)} />
    </div>
  );
}

function UserSettingsModal({ tab, onClose }: { tab: PopupTab | null; onClose: () => void }) {
  const { user } = useAuth();
  // Open on whichever tab the menu item that triggered this asked for, but let the user
  // switch between both once it's open - no reason to force a second click through the menu.
  const [activeTab, setActiveTab] = useState<PopupTab>(tab ?? 'profile');

  if (!user) return null;

  return (
    <Modal open={tab !== null} onClose={onClose} title="Account settings">
      <div className="mb-4 flex gap-1 border-b border-slate-200">
        {(['profile', 'password'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setActiveTab(t)}
            className={`px-3 py-2 text-sm font-medium ${
              activeTab === t ? 'border-b-2 border-slate-900 text-slate-900' : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            {t === 'profile' ? 'My Profile' : 'Change Password'}
          </button>
        ))}
      </div>

      {activeTab === 'profile' ? <ProfileTab /> : <ChangePasswordTab onDone={onClose} />}
    </Modal>
  );
}

function ProfileTab() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="grid grid-cols-2 gap-3 text-sm">
      <ProfileRow label="Name" value={`${user.firstName} ${user.lastName}`} />
      <ProfileRow label="Email" value={user.email} />
      <ProfileRow label="Designation" value={user.role.displayName} />
      <ProfileRow label="Employee ID" value={user.employeeId ?? '—'} />
      <ProfileRow label="Status" value={user.status} />
      <ProfileRow label="Last login" value={user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '—'} />
    </div>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400">{label}</p>
      <p className="mt-0.5 truncate font-medium text-slate-800">{value}</p>
    </div>
  );
}

function ChangePasswordTab({ onDone }: { onDone: () => void }) {
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [mismatch, setMismatch] = useState(false);

  const mutation = useMutation({
    mutationFn: () => changePassword({ oldPassword, newPassword }),
    onSuccess: () => {
      setOldPassword('');
      setNewPassword('');
      setConfirmPassword('');
      onDone();
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      setMismatch(true);
      return;
    }
    setMismatch(false);
    mutation.mutate();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <ErrorNotice error={mutation.error as AxiosError} />
      {mismatch && <p className="text-xs text-red-600">New password and confirmation don't match.</p>}
      <Field label="Current password">
        <input
          type="password"
          required
          className={inputClass}
          value={oldPassword}
          onChange={(e) => setOldPassword(e.target.value)}
        />
      </Field>
      <Field label="New password" hint="Minimum 8 characters.">
        <input
          type="password"
          required
          minLength={8}
          className={inputClass}
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
      </Field>
      <Field label="Confirm new password">
        <input
          type="password"
          required
          minLength={8}
          className={inputClass}
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
      </Field>
      <button
        type="submit"
        disabled={mutation.isPending}
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {mutation.isPending ? 'Changing…' : 'Change password'}
      </button>
    </form>
  );
}
