import { describe, expect, it } from 'vitest';
import {
  DASHBOARD_PERMISSION,
  authErrorMessage,
  grantAccess,
  parseRoleRecord,
  parseUserAccessRecord,
  routeForPath,
} from './access';

describe('controle de acesso', () => {
  it('valida o vínculo entre usuário e papel', () => {
    expect(parseUserAccessRecord({ active: true, roleId: ' admin ' })).toEqual({
      active: true,
      roleId: 'admin',
    });
    expect(parseUserAccessRecord({ active: true, roleId: '' })).toBeNull();
  });

  it('valida e normaliza as permissões do papel', () => {
    expect(parseRoleRecord({
      active: true,
      name: ' Administrador ',
      permissions: ['dashboard:view', 'dashboard:view', 'templates:read'],
    })).toEqual({
      active: true,
      name: 'Administrador',
      permissions: ['dashboard:view', 'templates:read'],
    });
  });

  it('concede acesso somente a usuário e papel ativos com a permissão exigida', () => {
    const role = parseRoleRecord({
      active: true,
      name: 'Administrador',
      permissions: [DASHBOARD_PERMISSION],
    });

    expect(grantAccess({ active: true, roleId: 'admin' }, role, DASHBOARD_PERMISSION)).toEqual({
      roleId: 'admin',
      roleName: 'Administrador',
      permissions: [DASHBOARD_PERMISSION],
    });
    expect(grantAccess({ active: false, roleId: 'admin' }, role, DASHBOARD_PERMISSION)).toBeNull();
    expect(grantAccess({ active: true, roleId: 'admin' }, role, 'users:manage')).toBeNull();
  });
});

describe('roteamento', () => {
  it('protege qualquer rota do painel', () => {
    expect(routeForPath('/painel')).toBe('/painel');
    expect(routeForPath('/painel/templates')).toBe('/painel');
    expect(routeForPath('/')).toBe('/login');
  });
});

describe('mensagens de autenticação', () => {
  it('não expõe detalhes de credenciais inválidas', () => {
    expect(authErrorMessage({ code: 'auth/invalid-credential' })).toBe('E-mail ou senha inválidos.');
  });
});
