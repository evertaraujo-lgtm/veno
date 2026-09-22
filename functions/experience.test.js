import assert from 'node:assert/strict';
import test from 'node:test';
import {
  integrationParameters,
  integrationRequestId,
  parseIntegrationInput,
  validIdempotencyKey,
  validIntegrationKey,
} from './experience.js';

test('aceita apenas a chave Bearer correta', () => {
  const key = 'abcdefghijklmnopqrstuvwxyz012345';
  assert.equal(validIntegrationKey(`Bearer ${key}`, key), true);
  assert.equal(validIntegrationKey(`Bearer ${key}x`, key), false);
  assert.equal(validIntegrationKey(key, key), false);
});

test('normaliza número brasileiro e mantém número internacional explícito', () => {
  assert.deepEqual(parseIntegrationInput({
    template: 'participacao_chegando', nome: ' Ana ', numero: '(11) 99999-9999',
  }), {
    recipient: '5511999999999', templateName: 'participacao_chegando', language: 'en',
    parameters: {}, name: 'Ana',
  });
  assert.equal(parseIntegrationInput({
    template: 'participacao_chegando', nome: 'Ana', numero: '12345678',
  }), null);
  assert.equal(parseIntegrationInput({
    template: 'participacao_chegando', nome: 'Ana', numero: '11999999999',
    parametros: { 'body:evento': 42 },
  }), null);
  assert.equal(parseIntegrationInput({
    template: 'participacao_chegando', nome: 'Ana', numero: '+1 415 555 0100',
  })?.recipient, '14155550100');
});

test('preenche nome e exige os demais parâmetros do template', () => {
  const input = parseIntegrationInput({
    template: 'confirmar_data_participacao', nome: 'Ana', numero: '11999999999',
    parametros: { 'body:evento': 'Encontro', 'body:link': 'https://example.org' },
  });
  const definitions = [
    { key: 'body:nome', component: 'body', name: 'nome' },
    { key: 'body:evento', component: 'body', name: 'evento' },
    { key: 'body:link', component: 'body', name: 'link' },
  ];
  assert.deepEqual(integrationParameters(input, definitions), {
    'body:nome': 'Ana', 'body:evento': 'Encontro', 'body:link': 'https://example.org',
  });
  assert.equal(integrationParameters({ ...input, parameters: {} }, definitions), null);
  assert.deepEqual(integrationParameters(input, [{ key: 'body:1', component: 'body', name: '1' }]), null);
  assert.deepEqual(integrationParameters({ ...input, parameters: {} }, [
    { key: 'body:1', component: 'body', name: '1' },
  ]), { 'body:1': 'Ana' });
});

test('chave de idempotência gera documento estável', () => {
  assert.equal(validIdempotencyKey('evento_123456'), true);
  assert.equal(validIdempotencyKey('short'), false);
  assert.equal(integrationRequestId('evento_123456').length, 64);
  assert.equal(integrationRequestId('evento_123456'), integrationRequestId('evento_123456'));
});
