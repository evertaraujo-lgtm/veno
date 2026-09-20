import { getApps, initializeApp } from 'firebase-admin/app';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { HttpsError, onCall } from 'firebase-functions/v2/https';
import {
  buildCreateTemplatePayload,
  buildSendTemplatePayload,
  parseSendInput,
  parseTemplateInput,
} from './domain.js';

if (getApps().length === 0) {
  initializeApp();
}

const database = getFirestore();
const metaAccessToken = defineSecret('META_ACCESS_TOKEN');
const metaWabaId = defineSecret('META_WABA_ID');
const metaPhoneNumberId = defineSecret('META_PHONE_NUMBER_ID');
const functionOptions = {
  region: 'southamerica-east1',
  secrets: [metaAccessToken, metaWabaId, metaPhoneNumberId],
  timeoutSeconds: 30,
  memory: '256MiB',
  maxInstances: 5,
};
const graphVersion = 'v26.0';

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
  };
}

export const getMetaWorkspace = onCall(functionOptions, async (request) => {
  await requirePermission(request, 'meta:manage');
  const wabaId = secretValue(metaWabaId, 'META_WABA_ID');
  const phoneNumberId = secretValue(metaPhoneNumberId, 'META_PHONE_NUMBER_ID');
  const query = new URLSearchParams({
    fields: 'id,name,status,category,language,components',
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

  const wabaId = secretValue(metaWabaId, 'META_WABA_ID');
  const templatesQuery = new URLSearchParams({
    fields: 'id,name,status,language',
    limit: '100',
  });
  const templatesPayload = await metaRequest(
    `${encodeURIComponent(wabaId)}/message_templates?${templatesQuery}`,
  );
  const matchingTemplate = Array.isArray(templatesPayload.data)
    ? templatesPayload.data.find((template) => (
      template?.name === input.templateName && template?.language === input.language
    ))
    : null;

  if (!matchingTemplate || matchingTemplate.status !== 'APPROVED') {
    throw new HttpsError('failed-precondition', 'O template ainda não está aprovado pela Meta.');
  }

  const phoneNumberId = secretValue(metaPhoneNumberId, 'META_PHONE_NUMBER_ID');
  const payload = await metaRequest(`${encodeURIComponent(phoneNumberId)}/messages`, {
    method: 'POST',
    body: JSON.stringify(buildSendTemplatePayload(
      input.recipient,
      input.templateName,
      input.language,
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
