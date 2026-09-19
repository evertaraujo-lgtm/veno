import './style.css';
import {
  authErrorMessage,
  isEmailAllowed,
  parseAllowedEmails,
  routeForPath,
} from './access';

import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  connectAuthEmulator,
  getAuth,
  onAuthStateChanged,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
};

const configuredAdminEmails = parseAllowedEmails(import.meta.env.VITE_ADMIN_EMAILS);

const requiredConfiguration = Object.entries(firebaseConfig).filter(([, value]) => !value);

if (configuredAdminEmails.length === 0) {
  requiredConfiguration.push(['adminEmails', undefined]);
}

const firebaseApp = requiredConfiguration.length === 0 ? initializeApp(firebaseConfig) : null;
const auth = firebaseApp ? getAuth(firebaseApp) : null;

if (auth && import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL) {
  connectAuthEmulator(auth, import.meta.env.VITE_FIREBASE_AUTH_EMULATOR_URL, {
    disableWarnings: true,
  });
}

const rootElement = document.querySelector<HTMLDivElement>('#app');

if (!rootElement) {
  throw new Error('Elemento raiz da aplicação não encontrado.');
}

const root: HTMLDivElement = rootElement;

function isAdministrator(user: User | null): user is User {
  return user !== null && isEmailAllowed(user.email, configuredAdminEmails);
}

function navigate(path: string): void {
  window.location.assign(path);
}

function currentRoute(): '/login' | '/painel' {
  return routeForPath(window.location.pathname);
}

function icon(path: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}" /></svg>`;
}

function loginTemplate(): string {
  return `
    <main class="auth-shell">
      <section class="auth-story" aria-label="Sobre a Veno">
        <span class="eyebrow"><i></i> Plataforma de comunicação</span>
        <h1>Mensagens que chegam.<br><em>Conexões que ficam.</em></h1>
        <p>Uma ponte segura entre seus sistemas e cada conversa importante.</p>
        <div class="connection-visual" aria-hidden="true">
          <span class="connection-node node-a"></span>
          <span class="connection-node node-b"></span>
          <span class="connection-node node-c"></span>
          <span class="connection-line line-a"></span>
          <span class="connection-line line-b"></span>
        </div>
      </section>

      <section class="auth-panel">
        <div class="auth-card">
          <img class="auth-logo" src="/images/veno-logo.png" alt="Veno">
          <div class="auth-heading">
            <p>Bem-vindo de volta</p>
            <h2>Acesse sua plataforma</h2>
          </div>

          <form id="login-form" class="auth-form" novalidate>
            <p id="login-error" class="validation-summary" role="alert"></p>

            <label for="email">E-mail</label>
            <div class="input-wrap">
              ${icon('M4 6h16v12H4zM4 7l8 6 8-6')}
              <input id="email" name="email" autocomplete="username" type="email" placeholder="voce@empresa.com" required autofocus>
            </div>

            <div class="label-row">
              <label for="password">Senha</label>
              <button id="reset-password" class="text-button" type="button">Esqueceu a senha?</button>
            </div>
            <div class="input-wrap">
              ${icon('M7 10V8a5 5 0 0 1 10 0v2M5 10h14v10H5z')}
              <input id="password" name="password" autocomplete="current-password" type="password" placeholder="Digite sua senha" required>
            </div>

            <button id="login-button" type="submit" class="primary-button">
              <span>Entrar</span>
              ${icon('m9 5 7 7-7 7')}
            </button>
          </form>
        </div>

        <footer class="auth-footer">
          <span>© ${new Date().getFullYear()} Veno</span>
          <span>Envios sem fronteiras</span>
        </footer>
      </section>
    </main>`;
}

function dashboardTemplate(user: User): string {
  const email = escapeHtml(user.email ?? '');
  const initials = (user.displayName ?? user.email ?? 'VE')
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'VE';

  return `
    <div class="dashboard-shell">
      <aside class="sidebar">
        <a href="/painel" class="sidebar-brand" aria-label="Veno — início">
          <img src="/images/veno-logo.png" alt="Veno">
        </a>

        <nav class="sidebar-nav" aria-label="Navegação principal">
          <span class="nav-caption">Workspace</span>
          <a class="nav-item active" href="/painel">
            ${icon('M4 13h6V4H4zm10 7h6v-9h-6zM4 20h6v-3H4zm10-13h6V4h-6z')}
            Visão geral
          </a>
          <span class="nav-item disabled" aria-disabled="true">
            ${icon('M4 5h16v14H4zM8 9h8M8 13h6')}
            Templates
            <span>Em breve</span>
          </span>
          <span class="nav-item disabled" aria-disabled="true">
            ${icon('m3 11 18-8-8 18-2-8z')}
            Disparos
          </span>
          <span class="nav-item disabled" aria-disabled="true">
            ${icon('M8 12h8M12 8v8M5 4h14v16H5z')}
            Integrações
          </span>
        </nav>

        <div class="sidebar-bottom">
          <div class="workspace-card">
            <span class="status-dot"></span>
            <div><strong>Ambiente</strong><small>Produção</small></div>
          </div>
          <button id="logout-button" type="button" class="logout-button">
            ${icon('M10 5H5v14h5M14 8l4 4-4 4M8 12h10')}
            Sair
          </button>
        </div>
      </aside>

      <main class="dashboard-main">
        <header class="dashboard-header">
          <div>
            <span class="eyebrow"><i></i> Operação online</span>
            <h1>Olá, seja bem-vindo.</h1>
            <p>Acompanhe a operação da Veno em um só lugar.</p>
          </div>
          <div class="user-chip" title="${email}">
            <span>${escapeHtml(initials)}</span>
            <div><strong>Administrador</strong><small>${email}</small></div>
          </div>
        </header>

        <section class="metric-grid" aria-label="Indicadores">
          ${metricCard('accent', 'm3 11 18-8-8 18-2-8z', 'Mensagens enviadas', '0', 'Pronto para o primeiro envio')}
          ${metricCard('', 'M4 5h16v14H4zM8 9h8M8 13h6', 'Templates ativos', '0', 'Aguardando integração Meta')}
          ${metricCard('', 'm5 12 4 4L19 6', 'Taxa de entrega', '—', 'Sem dados no período')}
          ${metricCard('', 'M12 3a9 9 0 1 0 9 9M12 7v5l3 2', 'Em processamento', '0', 'Nenhum item na fila')}
        </section>

        <section class="dashboard-grid">
          <article class="content-card activity-card">
            <div class="card-heading">
              <div><span>Atividade</span><h2>Últimos disparos</h2></div>
              <button type="button" disabled>Ver todos</button>
            </div>
            <div class="empty-state">
              <span class="empty-orbit"><i></i></span>
              <h3>Tudo pronto para começar</h3>
              <p>Os disparos aparecerão aqui assim que a integração estiver configurada.</p>
            </div>
          </article>

          <article class="content-card setup-card">
            <div class="card-heading"><div><span>Configuração</span><h2>Primeiros passos</h2></div></div>
            <ol class="setup-list">
              <li class="done"><span>1</span><div><strong>Ambiente Veno</strong><small>Base criada e disponível</small></div></li>
              <li><span>2</span><div><strong>Conectar à Meta</strong><small>Credenciais da Cloud API</small></div></li>
              <li><span>3</span><div><strong>Sincronizar templates</strong><small>Modelos aprovados</small></div></li>
              <li><span>4</span><div><strong>Ativar aplicação</strong><small>Chave de acesso à API</small></div></li>
            </ol>
          </article>
        </section>
      </main>
    </div>`;
}

function metricCard(className: string, path: string, label: string, value: string, detail: string): string {
  return `
    <article class="metric-card ${className}">
      <div class="metric-icon">${icon(path)}</div>
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${detail}</small>
    </article>`;
}

function escapeHtml(value: string): string {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

function renderConfigurationError(missingKeys: string[]): void {
  document.title = 'Configuração necessária — Veno';
  document.body.className = 'auth-page';
  root.innerHTML = `
    <main class="simple-message">
      <img src="/images/veno-logo.png" alt="Veno">
      <h1>Ambiente ainda não configurado</h1>
      <p>Configurações ausentes: ${escapeHtml(missingKeys.join(', '))}.</p>
      <p>Para o ambiente local, execute <strong>npm run emulators</strong>.</p>
    </main>`;
}

function renderLogin(firebaseAuth: Auth): void {
  document.title = 'Entrar — Veno';
  document.body.className = 'auth-page';
  root.innerHTML = loginTemplate();

  const form = document.querySelector<HTMLFormElement>('#login-form');
  const emailInput = document.querySelector<HTMLInputElement>('#email');
  const passwordInput = document.querySelector<HTMLInputElement>('#password');
  const errorElement = document.querySelector<HTMLParagraphElement>('#login-error');
  const loginButton = document.querySelector<HTMLButtonElement>('#login-button');
  const resetButton = document.querySelector<HTMLButtonElement>('#reset-password');

  if (!form || !emailInput || !passwordInput || !errorElement || !loginButton || !resetButton) {
    throw new Error('Formulário de login incompleto.');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorElement.textContent = '';

    if (!form.reportValidity()) {
      return;
    }

    loginButton.disabled = true;
    loginButton.querySelector('span')!.textContent = 'Entrando…';

    try {
      await setPersistence(firebaseAuth, browserLocalPersistence);
      const credential = await signInWithEmailAndPassword(
        firebaseAuth,
        emailInput.value.trim(),
        passwordInput.value,
      );

      if (!isAdministrator(credential.user)) {
        await signOut(firebaseAuth);
        errorElement.textContent = 'Sua conta não possui acesso ao Veno.';
        return;
      }

      navigate('/painel');
    } catch (error) {
      errorElement.textContent = authErrorMessage(error);
    } finally {
      loginButton.disabled = false;
      loginButton.querySelector('span')!.textContent = 'Entrar';
    }
  });

  resetButton.addEventListener('click', async () => {
    const email = emailInput.value.trim();

    if (!email || !emailInput.checkValidity()) {
      errorElement.textContent = 'Informe um e-mail válido para redefinir a senha.';
      emailInput.focus();
      return;
    }

    try {
      await sendPasswordResetEmail(firebaseAuth, email);
      errorElement.classList.add('success-message');
      errorElement.textContent = 'Enviamos as instruções de redefinição para o seu e-mail.';
    } catch (error) {
      errorElement.classList.remove('success-message');
      errorElement.textContent = authErrorMessage(error);
    }
  });
}

function renderDashboard(user: User, firebaseAuth: Auth): void {
  document.title = 'Painel — Veno';
  document.body.className = 'dashboard-page';
  root.innerHTML = dashboardTemplate(user);

  document.querySelector<HTMLButtonElement>('#logout-button')?.addEventListener('click', async () => {
    await signOut(firebaseAuth);
    navigate('/login');
  });
}

if (!auth) {
  renderConfigurationError(requiredConfiguration.map(([key]) => key));
} else {
  if (currentRoute() === '/login') {
    renderLogin(auth);
  }

  onAuthStateChanged(auth, (user) => {
    const route = currentRoute();

    if (route === '/painel') {
      if (!isAdministrator(user)) {
        void signOut(auth).finally(() => navigate('/login'));
        return;
      }

      renderDashboard(user, auth);
      return;
    }

    if (isAdministrator(user)) {
      navigate('/painel');
      return;
    }

    if (!document.querySelector('#login-form')) {
      renderLogin(auth);
    }
  });
}
