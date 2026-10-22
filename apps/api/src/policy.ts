export type AccountRole = 'superadmin' | 'admin' | 'manager' | 'user';

export function isElevated(role: AccountRole) {
  return role === 'superadmin' || role === 'admin';
}

export function canManageAccount(
  actorRole: AccountRole,
  targetRole: AccountRole,
) {
  return actorRole === 'superadmin' || targetRole === 'user';
}

export function canChangeAccountRole(actorRole: AccountRole) {
  return actorRole === 'superadmin';
}

export function canOpenUserAdministration(role: AccountRole) {
  return isElevated(role) || role === 'manager';
}
