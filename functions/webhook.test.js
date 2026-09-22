import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import {
  incomingMessages,
  messageStatuses,
  shouldReplaceStatus,
  verifyChallenge,
  verifySignature,
  webhookEventId,
} from './webhook.js';

test('verifica o desafio apenas com o token configurado', () => {
  const query = {
    'hub.mode': 'subscribe',
    'hub.verify_token': 'token-secreto',
    'hub.challenge': '123456',
  };

  assert.equal(verifyChallenge(query, 'token-secreto'), '123456');
  assert.equal(verifyChallenge(query, 'outro-token'), null);
  assert.equal(verifyChallenge({ ...query, 'hub.mode': 'unsubscribe' }, 'token-secreto'), null);
});

test('aceita somente assinatura SHA-256 do corpo original', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = `sha256=${createHmac('sha256', 'segredo-do-app').update(body).digest('hex')}`;

  assert.equal(verifySignature(body, signature, 'segredo-do-app'), true);
  assert.equal(verifySignature(Buffer.from('{}'), signature, 'segredo-do-app'), false);
  assert.equal(verifySignature(body, signature, 'outro-segredo'), false);
  assert.equal(verifySignature(body, 'sha256=invalid', 'segredo-do-app'), false);
  assert.equal(verifySignature(body, undefined, 'segredo-do-app'), false);
});

test('extrai status apenas da conta e do número configurados', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'phone-1' },
          statuses: [{
            id: 'wamid.123',
            status: 'delivered',
            timestamp: '1720000000',
            recipient_id: '5511999999999',
          }],
        },
      }],
    }],
  };

  const statuses = messageStatuses(payload, 'waba-1', 'phone-1');
  assert.equal(statuses.length, 1);
  assert.equal(statuses[0].id, 'wamid.123');
  assert.equal(statuses[0].status, 'delivered');
  assert.equal(statuses[0].timestamp, 1720000000);
  assert.equal(statuses[0].recipient, '5511999999999');
  assert.match(statuses[0].documentId, /^[a-f0-9]{64}$/);
  assert.deepEqual(messageStatuses(payload, 'waba-2', 'phone-1'), []);
  assert.deepEqual(messageStatuses(payload, 'waba-1', 'phone-2'), []);
  assert.equal(messageStatuses({}, 'waba-1', 'phone-1'), null);
});

test('não deixa eventos repetidos ou atrasados regredirem o status', () => {
  const current = { status: 'delivered', eventTimestamp: 1720000000 };
  assert.equal(shouldReplaceStatus(null, { status: 'sent', timestamp: 1720000000 }), true);
  assert.equal(shouldReplaceStatus(current, { status: 'sent', timestamp: 1719999999 }), false);
  assert.equal(shouldReplaceStatus(current, { status: 'delivered', timestamp: 1720000000 }), false);
  assert.equal(shouldReplaceStatus(current, { status: 'read', timestamp: 1720000000 }), true);
  assert.equal(shouldReplaceStatus(current, { status: 'read', timestamp: 1720000001 }), true);
});

test('mantém cada transição de status e mensagem em um evento distinto e estável', () => {
  const sent = webhookEventId('status', 'wamid.1', 'sent', 1720000000, '5511999999999');
  const delivered = webhookEventId('status', 'wamid.1', 'delivered', 1720000001, '5511999999999');
  const message = webhookEventId('message', 'wamid.1');

  assert.equal(sent, webhookEventId('status', 'wamid.1', 'sent', 1720000000, '5511999999999'));
  assert.notEqual(sent, delivered);
  assert.notEqual(sent, message);
  assert.match(sent, /^[a-f0-9]{64}$/);
});

test('extrai mensagens de texto e mídia sem misturar contas ou números', () => {
  const payload = {
    object: 'whatsapp_business_account',
    entry: [{
      id: 'waba-1',
      changes: [{
        field: 'messages',
        value: {
          metadata: { phone_number_id: 'phone-1' },
          contacts: [{ wa_id: '5511999999999', profile: { name: 'Cliente' } }],
          messages: [
            {
              id: 'wamid.1',
              from: '5511999999999',
              type: 'text',
              timestamp: '1720000000',
              text: { body: 'Olá' },
            },
            {
              id: 'wamid.2',
              from: '5511999999999',
              type: 'image',
              timestamp: '1720000001',
              image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'Foto' },
              context: { id: 'wamid.outbound' },
            },
          ],
        },
      }],
    }],
  };

  const messages = incomingMessages(payload, 'waba-1', 'phone-1');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].contactName, 'Cliente');
  assert.deepEqual(messages[0].content, { text: 'Olá' });
  assert.match(messages[0].documentId, /^[a-f0-9]{64}$/);
  assert.deepEqual(messages[1].content, {
    mediaId: 'media-1',
    caption: 'Foto',
    mimeType: 'image/jpeg',
  });
  assert.equal(messages[1].contextMessageId, 'wamid.outbound');
  assert.deepEqual(incomingMessages(payload, 'waba-2', 'phone-1'), []);
  assert.deepEqual(incomingMessages(payload, 'waba-1', 'phone-2'), []);
});
