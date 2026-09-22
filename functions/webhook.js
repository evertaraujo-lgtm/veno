import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

export function verifyChallenge(query, verifyToken) {
  const mode = query?.['hub.mode'];
  const token = query?.['hub.verify_token'];
  const challenge = query?.['hub.challenge'];

  if (
    mode !== 'subscribe'
    || typeof token !== 'string'
    || typeof challenge !== 'string'
    || !verifyToken
  ) {
    return null;
  }

  const received = Buffer.from(token);
  const expected = Buffer.from(verifyToken);
  return received.length === expected.length && timingSafeEqual(received, expected)
    ? challenge
    : null;
}

export function verifySignature(rawBody, signature, appSecret) {
  if (
    !Buffer.isBuffer(rawBody)
    || typeof signature !== 'string'
    || !/^sha256=[a-f\d]{64}$/i.test(signature)
    || !appSecret
  ) {
    return false;
  }

  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(signature.slice(7), 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export function messageStatuses(payload, wabaId, phoneNumberId) {
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    return null;
  }

  const statuses = [];
  for (const entry of payload.entry) {
    if (entry?.id !== wabaId || !Array.isArray(entry.changes)) {
      continue;
    }

    for (const change of entry.changes) {
      if (
        change?.field !== 'messages'
        || change.value?.metadata?.phone_number_id !== phoneNumberId
        || !Array.isArray(change.value.statuses)
      ) {
        continue;
      }

      for (const item of change.value.statuses) {
        if (
          typeof item?.id === 'string'
          && item.id.length <= 512
          && ['sent', 'delivered', 'read', 'failed', 'deleted'].includes(item.status)
          && /^\d{1,12}$/.test(String(item.timestamp))
        ) {
          statuses.push({
            id: item.id,
            status: item.status,
            timestamp: Number(item.timestamp),
            recipient: typeof item.recipient_id === 'string' ? item.recipient_id : null,
            errorMessage: typeof item.errors?.[0]?.message === 'string'
              ? item.errors[0].message
              : null,
            documentId: createHash('sha256').update(item.id).digest('hex'),
          });
        }
      }
    }
  }

  return statuses;
}

export function incomingMessages(payload, wabaId, phoneNumberId) {
  if (payload?.object !== 'whatsapp_business_account' || !Array.isArray(payload.entry)) {
    return null;
  }

  const messages = [];
  for (const entry of payload.entry) {
    if (entry?.id !== wabaId || !Array.isArray(entry.changes)) {
      continue;
    }

    for (const change of entry.changes) {
      const value = change?.value;
      if (
        change?.field !== 'messages'
        || value?.metadata?.phone_number_id !== phoneNumberId
        || !Array.isArray(value.messages)
      ) {
        continue;
      }

      for (const message of value.messages) {
        if (
          typeof message?.id !== 'string'
          || !message.id
          || message.id.length > 512
          || typeof message.from !== 'string'
          || !/^\d{5,20}$/.test(message.from)
          || typeof message.type !== 'string'
          || !/^[a-z_]{1,40}$/.test(message.type)
          || !/^\d{1,12}$/.test(String(message.timestamp))
        ) {
          continue;
        }

        const contact = Array.isArray(value.contacts)
          ? value.contacts.find((item) => item?.wa_id === message.from)
          : null;
        const media = ['image', 'video', 'audio', 'document', 'sticker'].includes(message.type)
          ? message[message.type]
          : null;
        const content = {};

        if (message.type === 'text' && typeof message.text?.body === 'string') {
          content.text = message.text.body;
        } else if (media && typeof media.id === 'string') {
          content.mediaId = media.id;
          if (typeof media.caption === 'string') content.caption = media.caption;
          if (typeof media.mime_type === 'string') content.mimeType = media.mime_type;
          if (typeof media.filename === 'string') content.filename = media.filename;
        } else if (message.type === 'button') {
          if (typeof message.button?.text === 'string') content.text = message.button.text;
          if (typeof message.button?.payload === 'string') content.replyId = message.button.payload;
        } else if (message.type === 'interactive') {
          const reply = message.interactive?.button_reply ?? message.interactive?.list_reply;
          if (typeof reply?.id === 'string') content.replyId = reply.id;
          if (typeof reply?.title === 'string') content.text = reply.title;
        } else if (message.type === 'reaction') {
          if (typeof message.reaction?.message_id === 'string') content.reactionTo = message.reaction.message_id;
          if (typeof message.reaction?.emoji === 'string') content.emoji = message.reaction.emoji;
        } else if (message.type === 'location') {
          if (typeof message.location?.latitude === 'number') content.latitude = message.location.latitude;
          if (typeof message.location?.longitude === 'number') content.longitude = message.location.longitude;
          if (typeof message.location?.name === 'string') content.name = message.location.name;
        }

        messages.push({
          messageId: message.id,
          documentId: createHash('sha256').update(message.id).digest('hex'),
          from: message.from,
          type: message.type,
          eventTimestamp: Number(message.timestamp),
          contactName: typeof contact?.profile?.name === 'string' ? contact.profile.name : null,
          contextMessageId: typeof message.context?.id === 'string' ? message.context.id : null,
          content,
        });
      }
    }
  }

  return messages;
}

export function shouldReplaceStatus(previous, next) {
  if (!previous) {
    return true;
  }

  if (previous.eventTimestamp !== next.timestamp) {
    return previous.eventTimestamp < next.timestamp;
  }

  const order = { sent: 1, delivered: 2, read: 3, failed: 4, deleted: 5 };
  return (order[next.status] ?? 0) > (order[previous.status] ?? 0);
}

export function webhookEventId(kind, messageId, status = '', timestamp = 0, recipient = '') {
  return createHash('sha256')
    .update(JSON.stringify([kind, messageId, status, timestamp, recipient]))
    .digest('hex');
}
