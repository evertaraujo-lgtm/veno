export type AppRoute = '/login' | '/painel';

export const DASHBOARD_PERMISSION = 'dashboard:view';

export interface UserAccessRecord {
  active: boolean;
  roleId: string;
}

export interface RoleRecord {
  active: boolean;
  name: string;
  permissions: string[];
}

export interface GrantedAccess {
  roleId: string;
  roleName: string;
  permissions: string[];
}

export function routeForPath(pathname: string): AppRoute {
  return pathname.toLowerCase().startsWith('/painel') ? '/painel' : '/login';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    return null;
  }

  return [...new Set(value.map((item) => item.trim()).filter(Boolean))];
}

export function parseUserAccessRecord(value: unknown): UserAccessRecord | null {
  if (!isRecord(value) || typeof value.active !== 'boolean' || typeof value.roleId !== 'string') {
    return null;
  }

  const roleId = value.roleId.trim();
  return roleId ? { active: value.active, roleId } : null;
}

export function parseRoleRecord(value: unknown): RoleRecord | null {
  if (!isRecord(value) || typeof value.active !== 'boolean' || typeof value.name !== 'string') {
    return null;
  }

  const name = value.name.trim();
  const permissions = stringList(value.permissions);

  return name && permissions
    ? { active: value.active, name, permissions }
    : null;
}

export function grantAccess(
  userRecord: UserAccessRecord | null,
  roleRecord: RoleRecord | null,
  requiredPermission: string,
): GrantedAccess | null {
  if (!userRecord?.active || !roleRecord?.active || !roleRecord.permissions.includes(requiredPermission)) {
    return null;
  }

  return {
    roleId: userRecord.roleId,
    roleName: roleRecord.name,
    permissions: roleRecord.permissions,
  };
}

export function authErrorMessage(error: unknown): string {
  const code = typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : '';

  switch (code) {
    case 'auth/invalid-credential':
    case 'auth/invalid-email':
    case 'auth/user-disabled':
      return 'E-mail ou senha inválidos.';
    case 'auth/too-many-requests':
      return 'Muitas tentativas. Aguarde um momento e tente novamente.';
    case 'auth/network-request-failed':
      return 'Não foi possível acessar o serviço de login.';
    default:
      return 'Não foi possível entrar. Tente novamente.';
  }
}
