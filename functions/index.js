import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall, onRequest } from 'firebase-functions/v2/https';
import {
  buildCreateTemplatePayload,
  buildSendTemplatePayload,
  parseSendInput,
  parseTemplateInput,
  templateParameterDefinitions,
} from './domain.js';
import {
  integrationParameters,
  integrationRequestId,
  parseIntegrationInput,
  validIdempotencyKey,
  validIntegrationKey,
} from './experience.js';
import {
  incomingMessages,
  messageStatuses,
  shouldReplaceStatus,
  verifyChallenge,
  verifySignature,
  webhookEventId,
} from './webhook.js';

if (getApps().length === 0) {
  initializeApp();
}

const database = getFirestore();
const metaAccessToken = defineSecret('META_ACCESS_TOKEN');
const metaWabaId = defineSecret('META_WABA_ID');
const metaPhoneNumberId = defineSecret('META_PHONE_NUMBER_ID');
const metaWebhookVerifyToken = defineSecret('META_WEBHOOK_VERIFY_TOKEN');
const metaAppSecret = defineSecret('META_APP_SECRET');
const grobExperienceApiKey = defineSecret('GROB_EXPERIENCE_API_KEY');
const functionOptions = {
  region: 'southamerica-east1',
  secrets: [metaAccessToken, metaWabaId, metaPhoneNumberId],
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 5,
};
const webhookReadOptions = {
  region: 'southamerica-east1',
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 5,
};
const graphVersion = 'v26.0';

export const metaWebhookGrobEventos = onRequest({
  region: 'southamerica-east1',
  secrets: [metaWebhookVerifyToken, metaAppSecret, metaWabaId, metaPhoneNumberId],
  invoker: 'public',
  cors: false,
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 5,
}, async (request, response) => {
  if (request.method === 'GET') {
    const challenge = verifyChallenge(request.query, metaWebhookVerifyToken.value());
    response.status(challenge === null ? 403 : 200).type('text/plain').send(challenge ?? 'Forbidden');
    return;
  }

  if (request.method !== 'POST') {
    response.set('Allow', 'GET, POST').status(405).send('Method not allowed');
    return;
  }

  if (!verifySignature(request.rawBody, request.get('x-hub-signature-256'), metaAppSecret.value())) {
    response.status(403).send('Forbidden');
    return;
  }

  let payload;
  try {
    payload = JSON.parse(request.rawBody.toString('utf8'));
  } catch {
    response.status(400).send('Invalid JSON');
    return;
  }

  const statuses = messageStatuses(payload, metaWabaId.value(), metaPhoneNumberId.value());
  const messages = incomingMessages(payload, metaWabaId.value(), metaPhoneNumberId.value());
  if (statuses === null || messages === null) {
    response.status(400).send('Invalid webhook payload');
    return;
  }

  try {
    await Promise.all(statuses.map(async ({ id, status, timestamp, recipient, errorMessage, documentId }) => {
      const reference = database.doc(`metaMessageStatuses/${documentId}`);
      const eventReference = database.doc(`metaWebhookEvents/${webhookEventId('status', id, status, timestamp, recipient ?? '')}`);
      await database.runTransaction(async (transaction) => {
        const [previous, event] = await transaction.getAll(reference, eventReference);
        if (shouldReplaceStatus(previous.exists ? previous.data() : null, { status, timestamp })) {
          transaction.set(reference, {
            messageId: id,
            status,
            recipient,
            errorMessage,
            eventTimestamp: timestamp,
            updatedAt: FieldValue.serverTimestamp(),
          }, { merge: true });
        }

        if (!event.exists) {
          transaction.create(eventReference, {
            kind: 'status',
            messageId: id,
            status,
            recipient,
            errorMessage,
            eventTimestamp: timestamp,
            receivedAt: FieldValue.serverTimestamp(),
          });
        }
      });
    }).concat(messages.map(async ({ documentId, ...message }) => {
      const reference = database.doc(`metaIncomingMessages/${documentId}`);
      const eventReference = database.doc(`metaWebhookEvents/${webhookEventId('message', message.messageId)}`);
      await database.runTransaction(async (transaction) => {
        const [previous, event] = await transaction.getAll(reference, eventReference);
        if (!previous.exists) {
          transaction.create(reference, {
            ...message,
            receivedAt: FieldValue.serverTimestamp(),
          });
        }

        if (!event.exists) {
          transaction.create(eventReference, {
            kind: 'message',
            ...message,
            receivedAt: FieldValue.serverTimestamp(),
          });
        }
      });
    })));
  } catch (error) {
    console.error('Falha ao registrar evento do webhook da Meta.', error);
    response.status(500).send('Processing failed');
    return;
  }

  response.status(200).send('EVENT_RECEIVED');
});

async function requirePermission(request, permission) {
  const uid = request.auth?.uid;

  if (!uid) {
    throw new HttpsError('unauthenticated', 'Entre novamente para continuar.');
  }

  const userSnapshot = await database.doc(`users/${uid}`).get();
  const user = userSnapshot.data();

  if (!userSnapshot.exists || user?.active !== true || typeof user.roleId !== 'string') {
    throw new HttpsError('permission-denied', 'Seu usuário não está ativo no Veno.');
  }

  const roleSnapshot = await database.doc(`roles/${user.roleId}`).get();
  const role = roleSnapshot.data();

  if (
    !roleSnapshot.exists
    || role?.active !== true
    || !Array.isArray(role.permissions)
    || !role.permissions.includes(permission)
  ) {
    throw new HttpsError('permission-denied', 'Seu papel não possui permissão para gerenciar a Meta.');
  }

  return { uid, roleId: user.roleId };
}

export const listMetaWebhookEvents = onCall(webhookReadOptions, async (request) => {
  await requirePermission(request, 'meta:manage');

  const kind = request.data?.kind ?? 'all';
  const cursor = request.data?.cursor ?? null;
  if (!['all', 'message', 'status'].includes(kind)
    || (cursor !== null && (typeof cursor !== 'string' || !/^[a-f0-9]{64}$/.test(cursor)))) {
    throw new HttpsError('invalid-argument', 'Filtro ou cursor inválido.');
  }

  let query = database.collection('metaWebhookEvents');
  if (kind !== 'all') {
    query = query.where('kind', '==', kind);
  }
  query = query.orderBy('receivedAt', 'desc');

  if (cursor) {
    const lastSnapshot = await database.doc(`metaWebhookEvents/${cursor}`).get();
    if (!lastSnapshot.exists || (kind !== 'all' && lastSnapshot.get('kind') !== kind)) {
      throw new HttpsError('invalid-argument', 'Cursor inválido. Atualize a lista.');
    }
    query = query.startAfter(lastSnapshot);
  }

  const snapshots = await query.limit(101).get();
  const page = snapshots.docs.slice(0, 100);
  return {
    events: page.map((snapshot) => {
      const event = snapshot.data();
      return {
        id: snapshot.id,
        kind: event.kind,
        messageId: event.messageId ?? '',
        status: event.status ?? null,
        recipient: event.recipient ?? null,
        errorMessage: event.errorMessage ?? null,
        from: event.from ?? null,
        contactName: event.contactName ?? null,
        messageType: event.type ?? null,
        content: event.content ?? {},
        eventTimestamp: event.eventTimestamp ?? null,
        receivedAt: event.receivedAt?.toMillis() ?? null,
      };
    }),
    nextCursor: snapshots.docs.length > 100 ? page.at(-1)?.id ?? null : null,
  };
});

function secretValue(secret, label) {
  const value = secret.value().trim();

  if (!value) {
    throw new HttpsError('failed-precondition', `A configuração ${label} ainda não foi definida.`);
  }

  return value;
}

async function metaRequest(path, init = {}) {
  const accessToken = secretValue(metaAccessToken, 'META_ACCESS_TOKEN');
  let response;

  try {
    response = await fetch(`https://graph.facebook.com/${graphVersion}/${path}`, {
      ...init,
      signal: AbortSignal.timeout(15_000),
      headers: {
        authorization: `Bearer ${accessToken}`,
        'content-type': 'application/json',
        ...init.headers,
      },
    });
  } catch (error) {
    if (error?.name === 'TimeoutError') {
      throw new HttpsError('deadline-exceeded', 'A Meta demorou demais para responder. Tente novamente.');
    }

    throw new HttpsError('unavailable', 'Não foi possível conectar à Meta no momento.');
  }
  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const metaError = payload?.error;
    const message = typeof metaError?.message === 'string'
      ? metaError.message
      : 'A Meta recusou a solicitação.';
    const details = {
      metaCode: metaError?.code ?? null,
      metaSubcode: metaError?.error_subcode ?? null,
      traceId: metaError?.fbtrace_id ?? null,
    };
    throw new HttpsError('failed-precondition', message, details);
  }

  return payload;
}

async function approvedTemplate(templateName, language) {
  const wabaId = secretValue(metaWabaId, 'META_WABA_ID');
  const query = new URLSearchParams({
    fields: 'id,name,status,language,parameter_format,components',
    limit: '100',
  });
  const payload = await metaRequest(`${encodeURIComponent(wabaId)}/message_templates?${query}`);
  const template = Array.isArray(payload.data)
    ? payload.data.find((item) => item?.name === templateName && item?.language === language)
    : null;
  if (!template || template.status !== 'APPROVED') {
    throw new HttpsError('failed-precondition', 'O template e idioma informados não estão aprovados pela Meta.');
  }
  return template;
}

function bodyText(components) {
  if (!Array.isArray(components)) {
    return '';
  }

  const body = components.find((component) => component?.type === 'BODY');
  return typeof body?.text === 'string' ? body.text : '';
}

function publicTemplate(template) {
  return {
    id: String(template.id ?? ''),
    name: String(template.name ?? ''),
    language: String(template.language ?? ''),
    category: String(template.category ?? ''),
    status: String(template.status ?? 'UNKNOWN'),
    body: bodyText(template.components),
    parameters: templateParameterDefinitions(template),
  };
}

export const getMetaWorkspace = onCall(functionOptions, async (request) => {
  await requirePermission(request, 'meta:manage');
  const wabaId = secretValue(metaWabaId, 'META_WABA_ID');
  const phoneNumberId = secretValue(metaPhoneNumberId, 'META_PHONE_NUMBER_ID');
  const query = new URLSearchParams({
    fields: 'id,name,status,category,language,parameter_format,components',
    limit: '100',
  });
  const payload = await metaRequest(`${encodeURIComponent(wabaId)}/message_templates?${query}`);

  return {
    configured: true,
    graphVersion,
    account: {
      wabaIdSuffix: wabaId.slice(-6),
      phoneNumberIdSuffix: phoneNumberId.slice(-6),
    },
    templates: Array.isArray(payload.data) ? payload.data.map(publicTemplate) : [],
  };
});

export const createMetaTemplate = onCall(functionOptions, async (request) => {
  const actor = await requirePermission(request, 'meta:manage');
  const template = parseTemplateInput(request.data);

  if (!template) {
    throw new HttpsError(
      'invalid-argument',
      'Revise nome, idioma, categoria e textos. Este primeiro fluxo aceita somente templates sem variáveis.',
    );
  }

  const wabaId = secretValue(metaWabaId, 'META_WABA_ID');
  const payload = await metaRequest(`${encodeURIComponent(wabaId)}/message_templates`, {
    method: 'POST',
    body: JSON.stringify(buildCreateTemplatePayload(template)),
  });
  const templateId = String(payload.id ?? `${template.name}_${template.language}`);

  await database.doc(`metaTemplates/${templateId}`).set({
    ...template,
    metaTemplateId: payload.id ?? null,
    status: payload.status ?? 'PENDING',
    createdBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    id: String(payload.id ?? ''),
    status: String(payload.status ?? 'PENDING'),
  };
});

export const sendMetaTestMessage = onCall(functionOptions, async (request) => {
  const actor = await requirePermission(request, 'meta:manage');
  const input = parseSendInput(request.data);

  if (!input) {
    throw new HttpsError('invalid-argument', 'Informe um template válido e um número com DDI.');
  }

  const matchingTemplate = await approvedTemplate(input.templateName, input.language);

  const definitions = templateParameterDefinitions(matchingTemplate);
  const expectedKeys = new Set(definitions.map((definition) => definition.key));
  const receivedKeys = Object.keys(input.parameters);
  const missingParameter = definitions.find((definition) => !input.parameters[definition.key]);
  const hasUnexpectedParameter = receivedKeys.some((key) => !expectedKeys.has(key));

  if (missingParameter || hasUnexpectedParameter || receivedKeys.length !== definitions.length) {
    throw new HttpsError(
      'invalid-argument',
      missingParameter
        ? `Preencha o parâmetro {{${missingParameter.name}}} do template.`
        : 'Os parâmetros enviados não correspondem ao template selecionado. Atualize a página e tente novamente.',
    );
  }

  const phoneNumberId = secretValue(metaPhoneNumberId, 'META_PHONE_NUMBER_ID');
  const payload = await metaRequest(`${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(buildSendTemplatePayload(
      input.recipient,
      input.templateName,
      input.language,
      definitions,
      input.parameters,
    )),
  });
  const messageId = Array.isArray(payload.messages) ? payload.messages[0]?.id : null;

  await database.collection('testMessages').add({
    provider: 'meta',
    messageId: messageId ?? null,
    recipientLast4: input.recipient.slice(-4),
    templateName: input.templateName,
    language: input.language,
    status: 'accepted',
    sentBy: actor.uid,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { accepted: true, messageId: messageId ?? null };
});

export const sendGrobExperienceTemplate = onRequest({
  ...functionOptions,
  secrets: [...functionOptions.secrets, grobExperienceApiKey],
  invoker: 'public',
  cors: false,
}, async (request, response) => {
  response.set('Cache-Control', 'no-store');
  if (request.method !== 'POST') {
    response.set('Allow', 'POST').status(405).json({ error: 'method_not_allowed' });
    return;
  }

  if (!validIntegrationKey(request.get('authorization'), grobExperienceApiKey.value())) {
    response.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (!request.is('application/json') || !request.rawBody || request.rawBody.length > 16_384) {
    response.status(400).json({ error: 'invalid_json' });
    return;
  }

  let body;
  try {
    body = JSON.parse(request.rawBody.toString('utf8'));
  } catch {
    response.status(400).json({ error: 'invalid_json' });
    return;
  }

  const input = parseIntegrationInput(body);
  const key = request.get('idempotency-key');
  if (!input || !validIdempotencyKey(key)) {
    response.status(400).json({
      error: 'invalid_request',
      message: 'Informe template, nome, numero e Idempotency-Key válidos.',
    });
    return;
  }

  try {
    const template = await approvedTemplate(input.templateName, input.language);
    const parameters = integrationParameters(input, templateParameterDefinitions(template));
    if (!parameters) {
      response.status(422).json({
        error: 'invalid_parameters',
        message: 'Os parâmetros não correspondem às variáveis do template aprovado.',
      });
      return;
    }

    const reference = database.doc(`grobExperienceSendRequests/${integrationRequestId(key)}`);
    const fingerprint = integrationRequestId(JSON.stringify({
      recipient: input.recipient,
      templateName: input.templateName,
      language: input.language,
      parameters: Object.fromEntries(Object.entries(parameters).sort(([left], [right]) =>
        left.localeCompare(right))),
    }));
    const claim = await database.runTransaction(async (transaction) => {
      const previous = await transaction.get(reference);
      if (previous.exists) {
        const saved = previous.data();
        if (saved.fingerprint !== fingerprint) return { state: 'conflict' };
        if (saved.status === 'accepted') {
          return { state: 'accepted', messageId: saved.messageId ?? null };
        }
        if (saved.status !== 'rejected') return { state: 'pending' };
      }
      transaction.set(reference, {
        source: 'grobexperience',
        fingerprint,
        status: 'processing',
        recipientLast4: input.recipient.slice(-4),
        templateName: input.templateName,
        language: input.language,
        updatedAt: FieldValue.serverTimestamp(),
        ...(!previous.exists ? { createdAt: FieldValue.serverTimestamp() } : {}),
      }, { merge: true });
      return { state: 'claimed' };
    });

    if (claim.state === 'accepted') {
      response.status(200).json({ accepted: true, messageId: claim.messageId, duplicate: true });
      return;
    }
    if (claim.state !== 'claimed') {
      response.status(409).json({ error: claim.state === 'conflict' ? 'idempotency_conflict' : 'request_in_progress' });
      return;
    }

    let payload;
    try {
      const phoneNumberId = secretValue(metaPhoneNumberId, 'META_PHONE_NUMBER_ID');
      payload = await metaRequest(`${encodeURIComponent(phoneNumberId)}/messages`, {
        method: 'POST',
        body: JSON.stringify(buildSendTemplatePayload(
          input.recipient,
          input.templateName,
          input.language,
          templateParameterDefinitions(template),
          parameters,
        )),
      });
    } catch (error) {
      // Uma falha de rede pode ocorrer depois de a Meta aceitar o envio.
      // Nesse caso, a chave fica bloqueada para impedir uma duplicação automática.
      await reference.update({
        status: error instanceof HttpsError && error.code === 'failed-precondition'
          ? 'rejected' : 'unknown',
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw error;
    }

    const messageId = Array.isArray(payload.messages) ? payload.messages[0]?.id ?? null : null;
    if (typeof messageId !== 'string' || !messageId) {
      await reference.update({ status: 'unknown', updatedAt: FieldValue.serverTimestamp() });
      response.status(502).json({
        error: 'missing_message_id',
        message: 'A Meta não retornou o identificador do envio. Confira o status antes de tentar novamente.',
      });
      return;
    }
    await reference.update({
      status: 'accepted',
      messageId,
      updatedAt: FieldValue.serverTimestamp(),
    });
    response.status(202).json({ accepted: true, messageId, duplicate: false });
  } catch (error) {
    if (!(error instanceof HttpsError)) console.error('Falha no envio da integração GrobExperience.', error);
    const code = error instanceof HttpsError ? error.code : 'internal';
    const status = code === 'failed-precondition' ? 422
      : ['unavailable', 'deadline-exceeded'].includes(code) ? 502 : 500;
    response.status(status).json({
      error: code.replaceAll('-', '_'),
      message: status === 500 ? 'Não foi possível processar o envio.' : error.message,
    });
  }
});
