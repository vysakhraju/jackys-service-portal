// #218/#254: a shared NamePicker options source for the Permissions page's two user-id
// fields (grant, and history lookup). GET /users is SUPER_ADMIN/SERVICE_HEAD-only, same as
// the Permissions page itself (PERMISSION_ADMIN_ROLES) - unlike every other #218 picker,
// there's no narrower role reaching this screen to fall back for, so this needs no
// accessible/fallback split.
//
// Deliberately not status-filtered (unlike the technician pickers): granting to an
// inactive user isn't this screen's business to block (the backend can), and the history
// lookup specifically wants to include former employees, not just active ones.
import { useQuery } from '@tanstack/react-query';
import { listUsers } from './usersApi';
import type { NamePickerOption } from '../components/pickers/NamePicker';

export function useUserOptions(): { options: NamePickerOption[]; loading: boolean } {
  const { data, isLoading } = useQuery({ queryKey: ['users', 'name-picker-options'], queryFn: listUsers });
  // Role folded into the searchable name (not just a subtext) so typing a role name (e.g.
  // "QC Officer") narrows the list too, not just typing a person's name or email.
  const options = (data ?? []).map((u) => ({
    id: u.id,
    name: `${u.firstName} ${u.lastName} — ${u.role.displayName} (${u.email})`,
  }));
  return { options, loading: isLoading };
}
