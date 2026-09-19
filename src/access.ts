export type AppRoute = '/login' | '/painel';

export function routeForPath(pathname: string): AppRoute {
  return pathname.toLowerCase().startsWith('/painel') ? '/painel' : '/login';
}

export function parseAllowedEmails(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isEmailAllowed(email: string | null, allowedEmails: readonly string[]): boolean {
  return email !== null && allowedEmails.includes(email.trim().toLowerCase());
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
