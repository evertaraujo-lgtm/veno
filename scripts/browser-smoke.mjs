const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5100';
const debugUrl = process.argv[3] ?? 'http://127.0.0.1:9222';

const targetResponse = await fetch(
  `${debugUrl}/json/new?${encodeURIComponent(`${baseUrl}/login`)}`,
  { method: 'PUT' },
);

if (!targetResponse.ok) throw new Error(`Chrome DevTools indisponível: ${targetResponse.status}`);

const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
let sequence = 0;

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);
  if (!payload.id) return;
  const request = pending.get(payload.id);
  if (!request) return;
  pending.delete(payload.id);
  payload.error ? request.reject(payload.error) : request.resolve(payload.result);
});

await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

function command(method, params = {}) {
  const id = ++sequence;
  socket.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
}

async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text);
  return result.result.value;
}

async function waitFor(expression, timeout = 15000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    try {
      if (await evaluate(expression)) return;
    } catch {
      // A navegação pode substituir o contexto JavaScript entre duas tentativas.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Tempo esgotado aguardando: ${expression}`);
}

async function clickLink(path) {
  const rectangle = await evaluate(`(() => {
    const link = document.querySelector('.sidebar-nav a[href="${path}"]');
    if (!link) return null;
    const rect = link.getBoundingClientRect();
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  })()`);
  if (!rectangle) throw new Error(`Link ausente: ${path}`);

  await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...rectangle, button: 'left', clickCount: 1 });
  await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...rectangle, button: 'left', clickCount: 1 });
  await waitFor(`location.pathname === '${path}' && document.querySelector('.sidebar-nav a.active')?.getAttribute('href') === '${path}'`);
}

try {
  await command('Runtime.enable');
  await waitFor("document.readyState === 'complete'");

  if (await evaluate("Boolean(document.querySelector('#login-form'))")) {
    await evaluate(`(() => {
      document.querySelector('#email').value = 'admin@veno.local';
      document.querySelector('#password').value = 'Veno@123';
      document.querySelector('#login-form').requestSubmit();
    })()`);
  }

  await waitFor("location.pathname === '/painel' && Boolean(document.querySelector('.sidebar-nav'))");

  const routes = [
    ['/painel/templates', 'Templates', '#template-form', '#templates-list'],
    ['/painel/disparos', 'Disparos', '#test-send-form'],
    ['/painel/meta', 'Configuração Meta', '#meta-account-summary'],
    ['/painel/webhooks', 'Eventos WhatsApp', '#webhook-events'],
    ['/painel', 'Olá, seja bem-vindo.'],
  ];

  for (const [source] of routes) {
    await clickLink(source);
    for (const [path, heading, ...selectors] of routes) {
      await clickLink(path);
      const actual = await evaluate(`(() => ({
        heading: document.querySelector('main h1')?.textContent?.trim(),
        selectors: ${JSON.stringify(selectors)}.map((selector) => Boolean(document.querySelector(selector))),
      }))()`);
      if (actual.heading !== heading || actual.selectors.some((present) => !present)) {
        throw new Error(`Tela incorreta ao navegar de ${source} para ${path}: ${JSON.stringify(actual)}`);
      }
      console.log(`${source} → ${path}: ${actual.heading}`);
    }
  }
} finally {
  socket.close();
}
