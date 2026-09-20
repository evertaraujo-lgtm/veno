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

export function buildSendTemplatePayload(recipient, templateName, language) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: recipient,
    type: 'template',
    template: {
      name: templateName,
      language: { code: language },
    },
  };
}

export function parseSendInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const recipient = normalizePhoneNumber(value.recipient);
  const templateName = typeof value.templateName === 'string' ? value.templateName.trim() : '';
  const language = typeof value.language === 'string' ? value.language.trim() : '';

  return recipient && TEMPLATE_NAME_PATTERN.test(templateName) && LANGUAGE_PATTERN.test(language)
    ? { recipient, templateName, language }
    : null;
}
