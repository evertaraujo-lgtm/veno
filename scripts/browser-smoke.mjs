const baseUrl = process.argv[2] ?? 'http://127.0.0.1:5100';
const debugUrl = process.argv[3] ?? 'http://127.0.0.1:9222';

const targetResponse = await fetch(
  `${debugUrl}/json/new?${encodeURIComponent(`${baseUrl}/login`)}`,
  { method: 'PUT' },
);

if (!targetResponse.ok) {
  throw new Error(`Chrome DevTools indisponível: ${targetResponse.status}`);
}

const target = await targetResponse.json();
const socket = new WebSocket(target.webSocketDebuggerUrl);
const pending = new Map();
const browserEvents = [];
let sequence = 0;

socket.addEventListener('message', (event) => {
  const payload = JSON.parse(event.data);

  if (payload.id) {
    const request = pending.get(payload.id);
    if (request) {
      pending.delete(payload.id);
      payload.error ? request.reject(payload.error) : request.resolve(payload.result);
    }
    return;
  }

  if (payload.method === 'Runtime.exceptionThrown') {
    browserEvents.push(`exception: ${payload.params.exceptionDetails.text}`);
  }

  if (payload.method === 'Runtime.consoleAPICalled') {
    const values = payload.params.args.map((item) => item.value ?? item.description).join(' ');
    browserEvents.push(`console.${payload.params.type}: ${values}`);
  }

  if (payload.method === 'Network.loadingFailed') {
    browserEvents.push(`network: ${payload.params.errorText}`);
  }
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
  const result = await command('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });

  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text);
  }

  return result.result.value;
}

async function waitFor(expression, timeout = 10000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeout) {
    if (await evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Tempo esgotado aguardando: ${expression}`);
}

await command('Runtime.enable');
await command('Network.enable');
await waitFor("document.readyState === 'complete'");

if (await evaluate("Boolean(document.querySelector('#login-form'))")) {
  await evaluate(`(() => {
    const setValue = (selector, value) => {
      const element = document.querySelector(selector);
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setter.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue('#email', 'admin@veno.local');
    setValue('#password', 'Veno@123');
    document.querySelector('#login-form').requestSubmit();
  })()`);
}

await waitFor("location.pathname === '/painel'", 15000);
await evaluate("location.assign('/painel/meta')");
await waitFor("location.pathname === '/painel/meta' && Boolean(document.querySelector('#template-form'))", 15000);
await waitFor("document.querySelector('#meta-connection')?.textContent !== 'Verificando conexão…'", 25000);

const initial = await evaluate(`(() => ({
  title: document.title,
  connection: document.querySelector('#meta-connection')?.textContent,
  refreshDisabled: document.querySelector('#refresh-templates')?.disabled,
  createDisabled: document.querySelector('#template-form button[type="submit"]')?.disabled,
  sendDisabled: document.querySelector('#test-send-button')?.disabled,
}))()`);

await evaluate("document.querySelector('#refresh-templates').click()");
await waitFor("document.querySelector('#refresh-templates')?.disabled === true");
await waitFor("document.querySelector('#refresh-templates')?.disabled === false", 25000);

const afterClick = await evaluate(`(() => ({
  connection: document.querySelector('#meta-connection')?.textContent,
  message: document.querySelector('#meta-page-message')?.textContent,
  refreshDisabled: document.querySelector('#refresh-templates')?.disabled,
}))()`);

await evaluate(`(() => {
  const values = {
    '[name="name"]': 'teste_automatizado',
    '[name="body"]': 'Mensagem de teste automatizado.',
  };
  for (const [selector, value] of Object.entries(values)) {
    const element = document.querySelector(selector);
    element.value = value;
    element.dispatchEvent(new Event('input', { bubbles: true }));
  }
  document.querySelector('#template-form').requestSubmit();
})()`);
await waitFor("document.querySelector('#create-template-button')?.disabled === true");
await waitFor("document.querySelector('#create-template-button')?.disabled === false", 25000);

const afterCreate = await evaluate(`(() => ({
  message: document.querySelector('#meta-page-message')?.textContent,
  createLabel: document.querySelector('#create-template-button span')?.textContent,
  createDisabled: document.querySelector('#create-template-button')?.disabled,
}))()`);

console.log(JSON.stringify({ initial, afterClick, afterCreate, browserEvents }, null, 2));
socket.close();
