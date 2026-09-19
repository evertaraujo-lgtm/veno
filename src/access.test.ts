import { describe, expect, it } from 'vitest';
import {
  authErrorMessage,
  isEmailAllowed,
  parseAllowedEmails,
  routeForPath,
} from './access';

describe('controle de acesso', () => {
  it('normaliza a lista de administradores', () => {
    expect(parseAllowedEmails(' Admin@Veno.com, suporte@veno.com ')).toEqual([
      'admin@veno.com',
      'suporte@veno.com',
    ]);
  });

  it('nega acesso quando não há uma correspondência explícita', () => {
    expect(isEmailAllowed('outro@veno.com', ['admin@veno.com'])).toBe(false);
    expect(isEmailAllowed(null, ['admin@veno.com'])).toBe(false);
    expect(isEmailAllowed('admin@veno.com', [])).toBe(false);
  });

  it('compara e-mails sem diferenciar maiúsculas', () => {
    expect(isEmailAllowed('Admin@Veno.com', ['admin@veno.com'])).toBe(true);
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
