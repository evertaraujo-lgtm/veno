import { spawnSync } from 'node:child_process';

const projectId = process.argv[2] ?? 'praxisagendamentos';
const graphVersion = 'v26.0';

function readSecret(name) {
  const result = spawnSync(
    'firebase',
    ['functions:secrets:access', name, '--project', projectId],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        DEBUG: '',
        NODE_DEBUG: '',
        FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true',
        NO_COLOR: '1',
      },
    },
  );

  if (result.status !== 0) throw new Error(`Não foi possível acessar ${name}.`);
  return result.stdout.trim().split(/\r?\n/).filter(Boolean).at(-1)?.trim() ?? '';
}

const token = readSecret('META_ACCESS_TOKEN');
const wabaId = readSecret('META_WABA_ID');
if (!token || !/^\d+$/.test(wabaId)) throw new Error('Token ou WABA inválido.');

async function request(method) {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`,
    {
      method,
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = payload.error;
    throw new Error(`Meta recusou ${method} /subscribed_apps (HTTP ${response.status}, código ${error?.code ?? 'desconhecido'}): ${error?.message ?? 'resposta inválida'}`);
  }
  return payload;
}

const before = await request('GET');
const subscribedBefore = Array.isArray(before.data) ? before.data.length : 0;
if (subscribedBefore === 0) {
  const result = await request('POST');
  if (result.success !== true) throw new Error('A Meta não confirmou a inscrição do aplicativo.');
}

const after = await request('GET');
const subscribedAfter = Array.isArray(after.data) ? after.data.length : 0;
console.log(JSON.stringify({ subscribedBefore, subscribedAfter, success: subscribedAfter > 0 }));
if (subscribedAfter === 0) process.exitCode = 1;
