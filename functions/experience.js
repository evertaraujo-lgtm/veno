import { createHash, timingSafeEqual } from 'node:crypto';
import { normalizePhoneNumber, parseSendInput } from './domain.js';

export function validIntegrationKey(header, secret) {
  if (typeof header !== 'string' || typeof secret !== 'string' || !secret) return false;
  const match = /^Bearer ([A-Za-z0-9_-]{32,256})$/.exec(header);
  if (!match) return false;
  const supplied = createHash('sha256').update(match[1]).digest();
  const expected = createHash('sha256').update(secret).digest();
  return timingSafeEqual(supplied, expected);
}

export function parseIntegrationInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const rawNumber = typeof value.numero === 'string' ? value.numero.trim() : '';
  const digits = normalizePhoneNumber(rawNumber);
  if (!digits) return null;

  // A GrobExperience guarda números brasileiros com DDD, sem DDI.
  const recipient = /^\d{10,11}$/.test(digits) && !rawNumber.startsWith('+')
    ? `55${digits}`
    : rawNumber.startsWith('+') || /^55\d{10,11}$/.test(digits) ? digits : null;
  const name = typeof value.nome === 'string' ? value.nome.trim() : '';
  if (!recipient || !name || name.length > 256) return null;

  const input = parseSendInput({
    recipient,
    templateName: value.template,
    language: value.idioma ?? 'en',
    parameters: value.parametros ?? {},
  });
  return input ? { ...input, name } : null;
}

export function integrationParameters(input, definitions) {
  const parameters = { ...input.parameters };
  const nameParameter = definitions.find((definition) =>
    definition.component === 'body' && definition.name === 'nome')
    ?? (definitions.length === 1 && definitions[0].component === 'body'
      && definitions[0].name === '1' ? definitions[0] : null);
  if (nameParameter) parameters[nameParameter.key] = input.name;

  const expected = new Set(definitions.map((definition) => definition.key));
  const missing = definitions.find((definition) => !parameters[definition.key]);
  const unexpected = Object.keys(parameters).find((key) => !expected.has(key));
  return missing || unexpected ? null : parameters;
}

export function validIdempotencyKey(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

export function integrationRequestId(key) {
  return createHash('sha256').update(`grobexperience:${key}`).digest('hex');
}
