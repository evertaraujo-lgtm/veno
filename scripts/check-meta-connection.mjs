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

  if (result.status !== 0) {
    throw new Error(`Não foi possível acessar ${name}.`);
  }

  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  return lines.at(-1)?.trim() ?? '';
}

function secretShape(value, numeric = false) {
  return {
    length: value.length,
    hasWhitespace: /\s/.test(value),
    wrappedInQuotes: /^(['"]).*\1$/.test(value),
    validFormat: numeric ? /^\d+$/.test(value) : value.length > 20,
  };
}

function safeError(payload) {
  return {
    code: payload?.error?.code ?? null,
    subcode: payload?.error?.error_subcode ?? null,
    type: payload?.error?.type ?? null,
    message: payload?.error?.message ?? 'Resposta inválida da Meta.',
  };
}

async function check(label, path, token) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));

  return response.ok
    ? { label, ok: true, status: response.status }
    : { label, ok: false, status: response.status, error: safeError(payload) };
}

async function discoverWabas(path, token) {
  const response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
    headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { ok: false, status: response.status, error: safeError(payload) };
  }

  const accounts = Array.isArray(payload.data) ? payload.data : [];
  return {
    ok: true,
    status: response.status,
    count: accounts.length,
    accounts: accounts.map((account) => ({
      idSuffix: String(account.id ?? '').slice(-6),
      hasName: typeof account.name === 'string' && account.name.length > 0,
    })),
  };
}

async function objectType(id, token) {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(id)}?metadata=1`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({}));

  return response.ok
    ? { ok: true, type: payload?.metadata?.type ?? 'unknown' }
    : { ok: false, error: safeError(payload) };
}

async function discoverBusinesses(token) {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/me/businesses?fields=id,name&limit=100`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { ok: false, error: safeError(payload) };
  }

  const businesses = Array.isArray(payload.data) ? payload.data : [];
  const results = [];

  for (const business of businesses) {
    const id = String(business.id ?? '');
    results.push({
      idSuffix: id.slice(-6),
      owned: await discoverWabas(`${encodeURIComponent(id)}/owned_whatsapp_business_accounts?fields=id,name`, token),
      client: await discoverWabas(`${encodeURIComponent(id)}/client_whatsapp_business_accounts?fields=id,name`, token),
    });
  }

  return { ok: true, count: results.length, businesses: results };
}

async function inspectTokenTargets(token) {
  const query = new URLSearchParams({ input_token: token });
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/debug_token?${query}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    return { ok: false, error: safeError(payload) };
  }

  const granularScopes = Array.isArray(payload?.data?.granular_scopes)
    ? payload.data.granular_scopes
    : [];

  return {
    ok: true,
    isValid: payload?.data?.is_valid === true,
    scopes: granularScopes.map((entry) => ({
      scope: String(entry.scope ?? ''),
      targetIdSuffixes: Array.isArray(entry.target_ids)
        ? entry.target_ids.map((id) => String(id).slice(-6))
        : [],
    })),
  };
}

function placeholders(text) {
  if (typeof text !== 'string') return [];
  return [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1]);
}

async function inspectTemplateStructures(wabaId, token) {
  const query = new URLSearchParams({
    fields: 'name,language,status,parameter_format,components',
    limit: '100',
  });
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/message_templates?${query}`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) return { ok: false, error: safeError(payload) };

  return {
    ok: true,
    templates: (Array.isArray(payload.data) ? payload.data : []).map((template) => ({
      name: template.name,
      language: template.language,
      status: template.status,
      parameterFormat: template.parameter_format ?? 'POSITIONAL',
      components: (Array.isArray(template.components) ? template.components : []).map((component) => ({
        type: component.type,
        format: component.format ?? null,
        placeholders: placeholders(component.text),
        buttons: (Array.isArray(component.buttons) ? component.buttons : []).map((button) => ({
          type: button.type,
          placeholders: placeholders(button.url),
        })),
      })),
    })),
  };
}

async function inspectWebhookSubscription(wabaId, token) {
  const response = await fetch(
    `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(wabaId)}/subscribed_apps`,
    {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) return { ok: false, status: response.status, error: safeError(payload) };

  return {
    ok: true,
    count: Array.isArray(payload.data) ? payload.data.length : 0,
    apps: (Array.isArray(payload.data) ? payload.data : []).map((app) => ({
      idSuffix: String(app.id ?? '').slice(-6),
      subscribedFields: Array.isArray(app.subscribed_fields) ? app.subscribed_fields : [],
    })),
  };
}

const token = readSecret('META_ACCESS_TOKEN');
const wabaId = readSecret('META_WABA_ID');
const phoneNumberId = readSecret('META_PHONE_NUMBER_ID');

const checks = await Promise.all([
  check('token e WABA', `${encodeURIComponent(wabaId)}?fields=id,name`, token),
  check('templates do WABA', `${encodeURIComponent(wabaId)}/message_templates?fields=id,name,status,language&limit=1`, token),
  check('WABA configurada como número', `${encodeURIComponent(wabaId)}?fields=id,display_phone_number,verified_name`, token),
  check('número da Meta', `${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,quality_rating`, token),
]);
const wabaDiscovery = {
  owned: await discoverWabas(
    `${encodeURIComponent(wabaId)}/owned_whatsapp_business_accounts?fields=id,name`,
    token,
  ),
  client: await discoverWabas(
    `${encodeURIComponent(wabaId)}/client_whatsapp_business_accounts?fields=id,name`,
    token,
  ),
};
const objectTypes = {
  configuredWabaId: await objectType(wabaId, token),
  configuredPhoneNumberId: await objectType(phoneNumberId, token),
};
const businessDiscovery = await discoverBusinesses(token);
const tokenTargets = await inspectTokenTargets(token);
const templateStructures = await inspectTemplateStructures(wabaId, token);
const webhookSubscription = await inspectWebhookSubscription(wabaId, token);

console.log(JSON.stringify({
  secretFormats: {
    accessToken: secretShape(token),
    wabaId: secretShape(wabaId, true),
    phoneNumberId: secretShape(phoneNumberId, true),
    idsAreEqual: wabaId === phoneNumberId,
  },
  checks,
  wabaDiscovery,
  objectTypes,
  businessDiscovery,
  tokenTargets,
  templateStructures,
  webhookSubscription,
}, null, 2));
