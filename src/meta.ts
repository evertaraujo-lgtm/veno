import { httpsCallable, type Functions } from 'firebase/functions';

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  parameters: MetaTemplateParameter[];
}

interface MetaTemplateParameter {
  key: string;
  component: 'header' | 'body';
  name: string;
  named: boolean;
}

interface SendTestInput {
  templateName: string;
  language: string;
  recipient: string;
  parameters: Record<string, string>;
}

interface MetaWorkspace {
  configured: boolean;
  graphVersion: string;
  account: {
    wabaIdSuffix: string;
    phoneNumberIdSuffix: string;
  };
  templates: MetaTemplate[];
}

export type MetaView = 'config' | 'templates' | 'disparos';

function escapeHtml(value: string): string {
  const element = document.createElement('div');
  element.textContent = value;
  return element.innerHTML;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    APPROVED: 'Aprovado',
    PENDING: 'Em análise',
    REJECTED: 'Rejeitado',
    PAUSED: 'Pausado',
    DISABLED: 'Desativado',
  };

  return labels[status] ?? status;
}

function friendlyError(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error) {
    const message = String(error.message).replace(/^Firebase:\s*/i, '').replace(/\s*\(functions\/[^)]+\)\.?$/i, '');
    return message || 'Não foi possível concluir a operação.';
  }

  return 'Não foi possível concluir a operação.';
}

function templateRows(templates: MetaTemplate[]): string {
  if (templates.length === 0) {
    return `
      <div class="meta-empty">
        <strong>Nenhum template encontrado</strong>
        <span>Crie o primeiro template para enviá-lo à aprovação da Meta.</span>
      </div>`;
  }

  return templates.map((template) => `
    <article class="template-row">
      <div class="template-main">
        <div class="template-title">
          <strong>${escapeHtml(template.name)}</strong>
          <span class="status-badge status-${escapeHtml(template.status.toLowerCase())}">${escapeHtml(statusLabel(template.status))}</span>
        </div>
        <p>${escapeHtml(template.body || 'Template sem corpo textual.')}</p>
      </div>
      <div class="template-meta">
        <span>${escapeHtml(template.language)}</span>
        <span>${escapeHtml(template.category)}</span>
      </div>
    </article>`).join('');
}

function approvedOptions(templates: MetaTemplate[]): string {
  const approved = templates.filter((template) => template.status === 'APPROVED');

  if (approved.length === 0) {
    return '<option value="">Nenhum template aprovado</option>';
  }

  return approved.map((template) => (
    `<option value="${escapeHtml(template.name)}" data-language="${escapeHtml(template.language)}">${escapeHtml(template.name)} · ${escapeHtml(template.language)}</option>`
  )).join('');
}

function templateFormTemplate(): string {
  return `
    <article id="novo-template" class="content-card meta-form-card">
      <div class="card-heading">
        <div><span>Novo template</span><h2>Enviar para aprovação</h2></div>
      </div>
      <form id="template-form" class="settings-form">
        <div class="form-grid two-columns">
          <label>Nome interno
            <input name="name" type="text" required maxlength="512" pattern="[a-z0-9_]+" placeholder="confirmacao_agendamento">
            <small>Somente letras minúsculas, números e underline.</small>
          </label>
          <label>Idioma
            <select name="language" required>
              <option value="pt_BR">Português (Brasil)</option>
              <option value="en">Inglês</option>
              <option value="es">Espanhol</option>
            </select>
          </label>
        </div>
        <label>Categoria
          <select name="category" required>
            <option value="UTILITY">Utilidade</option>
            <option value="MARKETING">Marketing</option>
          </select>
        </label>
        <label>Mensagem
          <textarea name="body" required maxlength="1024" rows="5" placeholder="Seu agendamento foi confirmado."></textarea>
          <small>Neste primeiro fluxo, use texto fixo sem variáveis como {{1}}.</small>
        </label>
        <label>Rodapé <span class="optional-label">opcional</span>
          <input name="footer" type="text" maxlength="60" placeholder="Veno">
        </label>
        <button id="create-template-button" class="primary-button compact" type="submit"><span>Cadastrar template</span></button>
      </form>
    </article>`;
}

function testSendTemplate(): string {
  return `
    <article id="envio-teste" class="content-card meta-form-card test-send-card meta-single-card">
      <div class="card-heading">
        <div><span>Envio controlado</span><h2>Enviar mensagem de teste</h2></div>
      </div>
      <form id="test-send-form" class="settings-form">
        <label>Template aprovado
          <select id="test-template" name="templateName" required disabled>
            <option value="">Carregando templates…</option>
          </select>
        </label>
        <div id="test-parameters" class="parameter-fields" aria-live="polite"></div>
        <label>Número de destino
          <input name="recipient" type="tel" required inputmode="tel" placeholder="+55 11 99999-9999">
          <small>Informe DDI e DDD. O envio será feito para apenas este número.</small>
        </label>
        <div class="send-warning">O botão será liberado quando houver pelo menos um template aprovado pela Meta.</div>
        <button id="test-send-button" class="primary-button compact" type="submit" disabled><span>Enviar teste</span></button>
      </form>
    </article>`;
}

function templateListTemplate(): string {
  return `
    <section id="templates" class="content-card templates-card">
      <div class="card-heading">
        <div><span>Biblioteca Meta</span><h2>Templates cadastrados</h2></div>
        <button id="refresh-templates" type="button">Atualizar status</button>
      </div>
      <div id="templates-list" class="templates-list">
        <div class="meta-empty"><span>Carregando templates…</span></div>
      </div>
    </section>`;
}

export function metaPanelTemplate(view: MetaView): string {
  const headings = {
    config: ['Configuração Meta', 'Confira a conexão da conta e acesse as ferramentas do WhatsApp.'],
    templates: ['Templates', 'Cadastre modelos de mensagem e acompanhe a aprovação da Meta.'],
    disparos: ['Disparos', 'Envie uma mensagem de teste com um template aprovado.'],
  };
  const [title, description] = headings[view];

  return `
    <header class="dashboard-header meta-header">
      <div>
        <span class="eyebrow"><i></i> WhatsApp Cloud API</span>
        <h1>${title}</h1>
        <p>${description}</p>
      </div>
      <div class="meta-header-actions">
        ${view === 'config' ? '' : '<a class="webhook-back-link" href="/painel/meta">Configuração Meta</a>'}
        <div id="meta-connection" class="connection-chip loading">Verificando conexão…</div>
      </div>
    </header>

    <p id="meta-page-message" class="page-message" role="status"></p>

    ${view === 'config' ? `
      <section class="meta-overview-grid" aria-label="Ferramentas da Meta">
        <article class="content-card meta-overview-card">
          <span>Conexão</span>
          <h2>Conta WhatsApp</h2>
          <p id="meta-account-summary">Consultando a conta configurada…</p>
        </article>
        <a class="content-card meta-overview-card meta-overview-link" href="/painel/templates"><span>Modelos</span><h2>Templates</h2><p>Cadastre mensagens e acompanhe a aprovação.</p></a>
        <a class="content-card meta-overview-card meta-overview-link" href="/painel/disparos"><span>Envio</span><h2>Disparos</h2><p>Envie uma mensagem de teste com um modelo aprovado.</p></a>
        <a class="content-card meta-overview-card meta-overview-link" href="/painel/webhooks"><span>Recebimento</span><h2>Eventos WhatsApp</h2><p>Veja mensagens recebidas e atualizações de status.</p></a>
      </section>` : view === 'templates' ? `
      <div class="meta-single-layout">${templateFormTemplate()}${templateListTemplate()}</div>` : testSendTemplate()}`;
}

export async function bindMetaPanel(functions: Functions, view: MetaView): Promise<void> {
  const message = document.querySelector<HTMLParagraphElement>('#meta-page-message');
  const connection = document.querySelector<HTMLDivElement>('#meta-connection');
  const accountSummary = document.querySelector<HTMLParagraphElement>('#meta-account-summary');
  const list = document.querySelector<HTMLDivElement>('#templates-list');
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-templates');
  const templateForm = document.querySelector<HTMLFormElement>('#template-form');
  const sendForm = document.querySelector<HTMLFormElement>('#test-send-form');
  const templateSelect = document.querySelector<HTMLSelectElement>('#test-template');
  const parameterFields = document.querySelector<HTMLDivElement>('#test-parameters');
  const sendButton = document.querySelector<HTMLButtonElement>('#test-send-button');
  const createButton = document.querySelector<HTMLButtonElement>('#create-template-button');

  if (!message || !connection
    || (view === 'config' && !accountSummary)
    || (view === 'templates' && (!list || !refreshButton || !templateForm || !createButton))
    || (view === 'disparos' && (!sendForm || !templateSelect || !parameterFields || !sendButton))) {
    throw new Error('Tela da Meta incompleta.');
  }

  const messageElement = message;
  const connectionElement = connection;
  const getWorkspace = httpsCallable<Record<string, never>, MetaWorkspace>(functions, 'getMetaWorkspace');
  const createTemplate = httpsCallable(functions, 'createMetaTemplate');
  const sendTestMessage = httpsCallable<SendTestInput, { accepted: boolean; messageId: string | null }>(functions, 'sendMetaTestMessage');
  let currentTemplates: MetaTemplate[] = [];

  function showMessage(text: string, success = false): void {
    messageElement.textContent = text;
    messageElement.classList.toggle('success', success);
  }

  function renderParameterFields(): void {
    if (!templateSelect || !parameterFields) return;

    const selectedOption = templateSelect.selectedOptions[0];
    const selectedTemplate = currentTemplates.find((template) => (
      template.name === templateSelect.value
      && template.language === selectedOption?.dataset.language
    ));
    const parameters = selectedTemplate?.parameters ?? [];

    if (!selectedTemplate) {
      parameterFields.innerHTML = '';
      return;
    }

    if (parameters.length === 0) {
      parameterFields.innerHTML = '<p class="parameter-empty">Este template não possui parâmetros.</p>';
      return;
    }

    parameterFields.innerHTML = `
      <div class="parameter-heading">
        <strong>Parâmetros da mensagem</strong>
        <span>Preencha os valores que substituirão as variáveis do template.</span>
      </div>
      ${parameters.map((parameter) => `
        <label>
          ${parameter.named ? 'Variável' : 'Parâmetro'} {{${escapeHtml(parameter.name)}}}
          <input
            type="text"
            required
            maxlength="1024"
            data-parameter-key="${escapeHtml(parameter.key)}"
            placeholder="Valor para {{${escapeHtml(parameter.name)}}}"
          >
          <small>${parameter.component === 'header' ? 'Cabeçalho' : 'Corpo'} do template</small>
        </label>
      `).join('')}`;
  }

  async function loadWorkspace(): Promise<void> {
    if (refreshButton) {
      refreshButton.disabled = true;
      refreshButton.textContent = 'Atualizando…';
    }
    connectionElement.className = 'connection-chip loading';
    connectionElement.textContent = 'Verificando conexão…';
    showMessage('Consultando sua conta da Meta…');

    try {
      const response = await getWorkspace({});
      const workspace = response.data;
      const templates = workspace.templates ?? [];
      currentTemplates = templates;
      connectionElement.className = 'connection-chip connected';
      connectionElement.textContent = `Conectado · WABA …${workspace.account.wabaIdSuffix} · ${workspace.graphVersion}`;
      if (accountSummary) {
        accountSummary.textContent = `WABA final …${workspace.account.wabaIdSuffix} · Número final …${workspace.account.phoneNumberIdSuffix} · Graph API ${workspace.graphVersion}`;
      }
      if (list) list.innerHTML = templateRows(templates);
      if (templateSelect) templateSelect.innerHTML = approvedOptions(templates);
      const hasApprovedTemplate = templates.some((template) => template.status === 'APPROVED');
      if (templateSelect) templateSelect.disabled = !hasApprovedTemplate;
      if (sendButton) {
        sendButton.disabled = !hasApprovedTemplate;
        sendButton.querySelector('span')!.textContent = hasApprovedTemplate
          ? 'Enviar teste'
          : 'Aguardando template aprovado';
      }
      renderParameterFields();
      showMessage('Configuração carregada.', true);
    } catch (error) {
      connectionElement.className = 'connection-chip disconnected';
      connectionElement.textContent = 'Meta não configurada';
      if (accountSummary) accountSummary.textContent = 'Não foi possível consultar a conta. Confira as credenciais do backend.';
      if (list) list.innerHTML = '<div class="meta-empty"><strong>Não foi possível consultar a Meta</strong><span>Confira as credenciais seguras do backend.</span></div>';
      if (templateSelect) templateSelect.innerHTML = '<option value="">Configuração indisponível</option>';
      currentTemplates = [];
      renderParameterFields();
      if (templateSelect) templateSelect.disabled = true;
      if (sendButton) sendButton.disabled = true;
      showMessage(friendlyError(error));
    } finally {
      if (refreshButton) {
        refreshButton.disabled = false;
        refreshButton.textContent = 'Atualizar status';
      }
    }
  }

  refreshButton?.addEventListener('click', () => {
    void loadWorkspace();
  });

  templateSelect?.addEventListener('change', renderParameterFields);

  templateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!templateForm.reportValidity() || !createButton) {
      return;
    }

    const buttonLabel = createButton.querySelector('span')!;
    const formData = new FormData(templateForm);
    createButton.disabled = true;
    buttonLabel.textContent = 'Cadastrando…';
    showMessage('Enviando o template para análise da Meta…');

    try {
      const response = await createTemplate({
        name: String(formData.get('name') ?? ''),
        language: String(formData.get('language') ?? ''),
        category: String(formData.get('category') ?? ''),
        body: String(formData.get('body') ?? ''),
        footer: String(formData.get('footer') ?? ''),
      });
      const result = response.data as { status?: string };
      templateForm.reset();
      await loadWorkspace();
      showMessage(`Template enviado à Meta com status ${statusLabel(result.status ?? 'PENDING')}.`, true);
    } catch (error) {
      showMessage(friendlyError(error));
    } finally {
      createButton.disabled = false;
      buttonLabel.textContent = 'Cadastrar template';
    }
  });

  sendForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!sendForm.reportValidity() || !templateSelect || !parameterFields || !sendButton) {
      return;
    }

    const selectedOption = templateSelect.selectedOptions[0];
    const language = selectedOption?.dataset.language ?? '';
    const formData = new FormData(sendForm);
    const parameters = Object.fromEntries(
      [...parameterFields.querySelectorAll<HTMLInputElement>('input[data-parameter-key]')]
        .map((input) => [input.dataset.parameterKey ?? '', input.value]),
    );
    sendButton.disabled = true;
    sendButton.querySelector('span')!.textContent = 'Enviando…';
    showMessage('Solicitando o envio da mensagem de teste…');

    try {
      const response = await sendTestMessage({
        templateName: String(formData.get('templateName') ?? ''),
        language,
        recipient: String(formData.get('recipient') ?? ''),
        parameters,
      });
      showMessage(
        response.data.messageId
          ? `Mensagem aceita pela Meta. ID: ${response.data.messageId}`
          : 'Mensagem aceita pela Meta.',
        true,
      );
    } catch (error) {
      showMessage(friendlyError(error));
    } finally {
      sendButton.disabled = false;
      sendButton.querySelector('span')!.textContent = 'Enviar teste';
    }
  });

  await loadWorkspace();
}
