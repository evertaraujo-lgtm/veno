const TEMPLATE_NAME_PATTERN = /^[a-z0-9_]{1,512}$/;
const LANGUAGE_PATTERN = /^[a-z]{2,3}(?:_[A-Z]{2})?$/;
const PHONE_PATTERN = /^\d{8,15}$/;
const TEMPLATE_CATEGORIES = new Set(['UTILITY', 'MARKETING']);

export function normalizePhoneNumber(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.replace(/[\s()+.-]/g, '');
  return PHONE_PATTERN.test(normalized) ? normalized : null;
}

export function parseTemplateInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const language = typeof value.language === 'string' ? value.language.trim() : '';
  const category = typeof value.category === 'string' ? value.category.trim().toUpperCase() : '';
  const body = typeof value.body === 'string' ? value.body.trim() : '';
  const footer = typeof value.footer === 'string' ? value.footer.trim() : '';

  if (
    !TEMPLATE_NAME_PATTERN.test(name)
    || !LANGUAGE_PATTERN.test(language)
    || !TEMPLATE_CATEGORIES.has(category)
    || body.length === 0
    || body.length > 1024
    || footer.length > 60
    || body.includes('{{')
    || footer.includes('{{')
  ) {
    return null;
  }

  return { name, language, category, body, footer };
}

export function buildCreateTemplatePayload(template) {
  const components = [{ type: 'BODY', text: template.body }];

  if (template.footer) {
    components.push({ type: 'FOOTER', text: template.footer });
  }

  return {
    name: template.name,
    language: template.language,
    category: template.category,
    components,
  };
}

function placeholders(text) {
  if (typeof text !== 'string') {
    return [];
  }

  return [...text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)].map((match) => match[1].trim());
}

export function templateParameterDefinitions(template) {
  const named = String(template?.parameter_format ?? '').toUpperCase() === 'NAMED';
  const definitions = [];

  for (const component of Array.isArray(template?.components) ? template.components : []) {
    const componentType = String(component?.type ?? '').toLowerCase();

    if (!['header', 'body'].includes(componentType)) {
      continue;
    }

    const seen = new Set();
    for (const name of placeholders(component?.text)) {
      if (seen.has(name)) {
        continue;
      }

      seen.add(name);
      definitions.push({
        key: `${componentType}:${name}`,
        component: componentType,
        name,
        named,
      });
    }
  }

  return definitions;
}

export function buildSendTemplatePayload(
  recipient,
  templateName,
  language,
  definitions = [],
  values = {},
) {
  const template = {
    name: templateName,
    language: { code: language },
  };
  const componentNames = [...new Set(definitions.map((definition) => definition.component))];

  if (componentNames.length > 0) {
    template.components = componentNames.map((component) => ({
      type: component,
      parameters: definitions
        .filter((definition) => definition.component === component)
        .map((definition) => ({
          type: 'text',
          ...(definition.named ? { parameter_name: definition.name } : {}),
          text: values[definition.key],
        })),
    }));
  }

  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template,
  };
}

export function parseSendInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const recipient = normalizePhoneNumber(value.recipient);
  const templateName = typeof value.templateName === 'string' ? value.templateName.trim() : '';
  const language = typeof value.language === 'string' ? value.language.trim() : '';
  const rawParameters = value.parameters ?? {};

  if (!rawParameters || typeof rawParameters !== 'object' || Array.isArray(rawParameters)) {
    return null;
  }

  const entries = Object.entries(rawParameters);
  if (
    entries.length > 50
    || entries.some(([key, parameter]) => (
      key.length === 0
      || key.length > 128
      || typeof parameter !== 'string'
      || parameter.trim().length > 1024
    ))
  ) {
    return null;
  }

  const parameters = Object.fromEntries(entries.map(([key, parameter]) => [key, parameter.trim()]));

  return recipient && TEMPLATE_NAME_PATTERN.test(templateName) && LANGUAGE_PATTERN.test(language)
    ? { recipient, templateName, language, parameters }
    : null;
}
