import { spawnSync } from 'node:child_process';

const projectId = process.argv[2] ?? 'praxisagendamentos';
const graphVersion = 'v26.0';
const expectedCallbackUrl = `https://southamerica-east1-${projectId}.cloudfunctions.net/metaWebhookGrobEventos`;

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

async function graph(path, token, body) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    method: body ? 'POST' : 'GET',
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}),
    },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Meta recusou /${path} (HTTP ${response.status}, código ${payload.error?.code ?? 'desconhecido'}): ${payload.error?.message ?? 'resposta inválida'}`);
  }
  return payload;
}

const accessToken = readSecret('META_ACCESS_TOKEN');
const appSecret = readSecret('META_APP_SECRET');
const verifyToken = readSecret('META_WEBHOOK_VERIFY_TOKEN');
const debug = await graph(`debug_token?${new URLSearchParams({ input_token: accessToken })}`, accessToken);
const appId = String(debug.data?.app_id ?? '');
if (!/^\d+$/.test(appId)) throw new Error('A Meta não retornou um app_id válido.');

const appToken = `${appId}|${appSecret}`;
const path = `${appId}/subscriptions`;
const existing = await graph(path, appToken);
const subscription = existing.data?.find((item) => item.object === 'whatsapp_business_account');
if (!subscription || subscription.callback_url !== expectedCallbackUrl) {
  throw new Error('O callback atual do aplicativo não corresponde à função publicada.');
}

const fields = new Set((Array.isArray(subscription.fields) ? subscription.fields : [])
  .map((field) => typeof field === 'string' ? field : field.name)
  .filter(Boolean));

if (!fields.has('messages')) {
  fields.add('messages');
  const result = await graph(path, appToken, new URLSearchParams({
    object: 'whatsapp_business_account',
    callback_url: expectedCallbackUrl,
    verify_token: verifyToken,
    fields: [...fields].join(','),
  }));
  if (result.success !== true) throw new Error('A Meta não confirmou a assinatura do campo messages.');
}

const updated = await graph(path, appToken);
const updatedSubscription = updated.data?.find((item) => item.object === 'whatsapp_business_account');
const updatedFields = (Array.isArray(updatedSubscription?.fields) ? updatedSubscription.fields : [])
  .map((field) => typeof field === 'string' ? field : field.name);
console.log(JSON.stringify({
  callbackUrl: updatedSubscription?.callback_url ?? null,
  fields: updatedFields,
  messagesEnabled: updatedFields.includes('messages'),
}));
if (!updatedFields.includes('messages')) process.exitCode = 1;
