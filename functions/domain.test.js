import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCreateTemplatePayload,
  buildSendTemplatePayload,
  normalizePhoneNumber,
  parseSendInput,
  parseTemplateInput,
  templateParameterDefinitions,
} from './domain.js';

test('normaliza telefone internacional e rejeita valores inválidos', () => {
  assert.equal(normalizePhoneNumber('+55 (11) 99999-9999'), '5511999999999');
  assert.equal(normalizePhoneNumber('123'), null);
  assert.equal(normalizePhoneNumber('55abc'), null);
});

test('valida template textual simples', () => {
  assert.deepEqual(parseTemplateInput({
    name: 'confirmacao_agendamento',
    language: 'pt_BR',
    category: 'utility',
    body: 'Seu agendamento foi confirmado.',
    footer: 'Veno',
  }), {
    name: 'confirmacao_agendamento',
    language: 'pt_BR',
    category: 'UTILITY',
    body: 'Seu agendamento foi confirmado.',
    footer: 'Veno',
  });

  assert.equal(parseTemplateInput({
    name: 'Nome Inválido',
    language: 'pt_BR',
    category: 'UTILITY',
    body: 'Mensagem',
  }), null);
  assert.equal(parseTemplateInput({
    name: 'com_variavel',
    language: 'pt_BR',
    category: 'UTILITY',
    body: 'Olá, {{1}}',
  }), null);
});

test('monta payloads compatíveis com a Cloud API', () => {
  const template = parseTemplateInput({
    name: 'aviso_teste',
    language: 'pt_BR',
    category: 'MARKETING',
    body: 'Esta é uma mensagem de teste.',
    footer: '',
  });

  assert.ok(template);
  assert.deepEqual(buildCreateTemplatePayload(template), {
    name: 'aviso_teste',
    language: 'pt_BR',
    category: 'MARKETING',
    components: [{ type: 'BODY', text: 'Esta é uma mensagem de teste.' }],
  });
  assert.deepEqual(buildSendTemplatePayload('5511999999999', 'aviso_teste', 'pt_BR'), {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: '5511999999999',
    type: 'template',
    template: { name: 'aviso_teste', language: { code: 'pt_BR' } },
  });
  assert.deepEqual(parseSendInput({
    recipient: '+55 11 99999-9999',
    templateName: 'aviso_teste',
    language: 'pt_BR',
  }), {
    recipient: '5511999999999',
    templateName: 'aviso_teste',
    language: 'pt_BR',
    parameters: {},
  });
});

test('extrai e envia parâmetros nomeados na ordem do template', () => {
  const definitions = templateParameterDefinitions({
    parameter_format: 'NAMED',
    components: [{
      type: 'BODY',
      text: 'Olá, {{nome}}. O evento {{evento}} espera você, {{nome}}.',
    }],
  });

  assert.deepEqual(definitions, [
    { key: 'body:nome', component: 'body', name: 'nome', named: true },
    { key: 'body:evento', component: 'body', name: 'evento', named: true },
  ]);
  assert.deepEqual(buildSendTemplatePayload(
    '5511999999999',
    'lembrete',
    'pt_BR',
    definitions,
    { 'body:nome': 'Everton', 'body:evento': 'Reunião' },
  ).template.components, [{
    type: 'body',
    parameters: [
      { type: 'text', parameter_name: 'nome', text: 'Everton' },
      { type: 'text', parameter_name: 'evento', text: 'Reunião' },
    ],
  }]);
});

test('extrai e envia parâmetros posicionais de cabeçalho e corpo', () => {
  const definitions = templateParameterDefinitions({
    parameter_format: 'POSITIONAL',
    components: [
      { type: 'HEADER', text: 'Pedido {{1}}' },
      { type: 'BODY', text: 'Olá {{1}}, entrega em {{2}}.' },
    ],
  });

  assert.deepEqual(buildSendTemplatePayload(
    '5511999999999',
    'pedido',
    'pt_BR',
    definitions,
    { 'header:1': '42', 'body:1': 'Everton', 'body:2': 'Hoje' },
  ).template.components, [
    { type: 'header', parameters: [{ type: 'text', text: '42' }] },
    {
      type: 'body',
      parameters: [
        { type: 'text', text: 'Everton' },
        { type: 'text', text: 'Hoje' },
      ],
    },
  ]);
});
