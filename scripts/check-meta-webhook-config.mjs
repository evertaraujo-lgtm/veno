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

async function graph(path, token) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      code: payload.error?.code ?? null,
      message: payload.error?.message ?? 'Resposta inválida da Meta.',
    };
  }
  return { ok: true, payload };
}

const accessToken = readSecret('META_ACCESS_TOKEN');
const appSecret = readSecret('META_APP_SECRET');
const wabaId = readSecret('META_WABA_ID');
const phoneNumberId = readSecret('META_PHONE_NUMBER_ID');

const debug = await graph(`debug_token?${new URLSearchParams({ input_token: accessToken })}`, accessToken);
if (!debug.ok) throw new Error(`Não foi possível identificar o app: ${debug.message}`);
const appId = String(debug.payload.data?.app_id ?? '');
if (!/^\d+$/.test(appId)) throw new Error('A Meta não retornou um app_id válido.');

const subscriptions = await graph(`${appId}/subscriptions`, `${appId}|${appSecret}`);
const subscribedApps = await graph(`${wabaId}/subscribed_apps`, accessToken);
const phoneNumbers = await graph(`${wabaId}/phone_numbers?fields=id&limit=100`, accessToken);
const apps = subscribedApps.ok && Array.isArray(subscribedApps.payload.data)
  ? subscribedApps.payload.data
  : [];

console.log(JSON.stringify({
  appIdSuffix: appId.slice(-6),
  appSubscriptions: subscriptions.ok
    ? (Array.isArray(subscriptions.payload.data) ? subscriptions.payload.data : []).map((item) => ({
      object: item.object ?? null,
      callbackUrl: item.callback_url ?? null,
      fields: Array.isArray(item.fields) ? item.fields.map((field) => field.name ?? field) : [],
    }))
    : subscriptions,
  wabaSubscription: subscribedApps.ok
    ? {
      count: apps.length,
      matchingApp: apps.some((item) => String(item.whatsapp_business_api_data?.id ?? item.id ?? '') === appId),
      shapes: apps.map((item) => Object.keys(item)),
    }
    : subscribedApps,
  phoneBelongsToWaba: phoneNumbers.ok
    ? Array.isArray(phoneNumbers.payload.data)
      && phoneNumbers.payload.data.some((item) => String(item.id ?? '') === phoneNumberId)
    : phoneNumbers,
}, null, 2));
