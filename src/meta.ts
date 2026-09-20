import { httpsCallable, type Functions } from 'firebase/functions';

interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
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

export function metaPanelTemplate(): string {
  return `
    <header id="configuracao-meta" class="dashboard-header meta-header">
      <div>
        <span class="eyebrow"><i></i> WhatsApp Cloud API</span>
        <h1>Configuração Meta</h1>
        <p>Cadastre templates e valide o envio antes de iniciar os disparos.</p>
      </div>
      <div id="meta-connection" class="connection-chip loading">Verificando conexão…</div>
    </header>

    <p id="meta-page-message" class="page-message" role="status"></p>

    <section class="meta-layout">
      <article id="novo-template" class="content-card meta-form-card meta-anchor">
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
      </article>

      <article id="envio-teste" class="content-card meta-form-card test-send-card meta-anchor">
        <div class="card-heading">
          <div><span>Envio controlado</span><h2>Enviar mensagem de teste</h2></div>
        </div>
        <form id="test-send-form" class="settings-form">
          <label>Template aprovado
            <select id="test-template" name="templateName" required disabled>
              <option value="">Carregando templates…</option>
            </select>
          </label>
          <label>Número de destino
            <input name="recipient" type="tel" required inputmode="tel" placeholder="+55 11 99999-9999">
            <small>Informe DDI e DDD. O envio será feito para apenas este número.</small>
          </label>
          <div class="send-warning">
            O botão será liberado quando houver pelo menos um template aprovado pela Meta.
          </div>
          <button id="test-send-button" class="primary-button compact" type="submit" disabled><span>Enviar teste</span></button>
        </form>
      </article>
    </section>

    <section id="templates" class="content-card templates-card meta-anchor">
      <div class="card-heading">
        <div><span>Biblioteca Meta</span><h2>Templates cadastrados</h2></div>
        <button id="refresh-templates" type="button">Atualizar status</button>
      </div>
      <div id="templates-list" class="templates-list">
        <div class="meta-empty"><span>Carregando templates…</span></div>
      </div>
    </section>`;
}

export async function bindMetaPanel(functions: Functions): Promise<void> {
  const message = document.querySelector<HTMLParagraphElement>('#meta-page-message');
  const connection = document.querySelector<HTMLDivElement>('#meta-connection');
  const list = document.querySelector<HTMLDivElement>('#templates-list');
  const refreshButton = document.querySelector<HTMLButtonElement>('#refresh-templates');
  const templateForm = document.querySelector<HTMLFormElement>('#template-form');
  const sendForm = document.querySelector<HTMLFormElement>('#test-send-form');
  const templateSelect = document.querySelector<HTMLSelectElement>('#test-template');
  const sendButton = document.querySelector<HTMLButtonElement>('#test-send-button');
  const createButton = document.querySelector<HTMLButtonElement>('#create-template-button');

  if (!message || !connection || !list || !refreshButton || !templateForm || !sendForm || !templateSelect || !sendButton || !createButton) {
    throw new Error('Tela de configuração da Meta incompleta.');
  }

  const messageElement = message;
  const connectionElement = connection;
  const listElement = list;
  const refreshElement = refreshButton;
  const templateFormElement = templateForm;
  const sendFormElement = sendForm;
  const templateSelectElement = templateSelect;
  const sendButtonElement = sendButton;
  const createButtonElement = createButton;

  const getWorkspace = httpsCallable<Record<string, never>, MetaWorkspace>(functions, 'getMetaWorkspace');
  const createTemplate = httpsCallable(functions, 'createMetaTemplate');
  const sendTestMessage = httpsCallable<Record<string, string>, { accepted: boolean; messageId: string | null }>(functions, 'sendMetaTestMessage');

  const sectionId = window.location.hash.slice(1);
  const selectedSection = sectionId ? document.getElementById(sectionId) : null;

  if (selectedSection) {
    requestAnimationFrame(() => selectedSection.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  }

  function showMessage(text: string, success = false): void {
    messageElement.textContent = text;
    messageElement.classList.toggle('success', success);
  }

  async function loadWorkspace(): Promise<void> {
    refreshElement.disabled = true;
    refreshElement.textContent = 'Atualizando…';
    connectionElement.className = 'connection-chip loading';
    connectionElement.textContent = 'Verificando conexão…';
    showMessage('Consultando sua conta da Meta…');

    try {
      const response = await getWorkspace({});
      const workspace = response.data;
      const templates = workspace.templates ?? [];
      connectionElement.className = 'connection-chip connected';
      connectionElement.textContent = `Conectado · WABA …${workspace.account.wabaIdSuffix} · ${workspace.graphVersion}`;
      listElement.innerHTML = templateRows(templates);
      templateSelectElement.innerHTML = approvedOptions(templates);
      const hasApprovedTemplate = templates.some((template) => template.status === 'APPROVED');
      templateSelectElement.disabled = !hasApprovedTemplate;
      sendButtonElement.disabled = !hasApprovedTemplate;
      sendButtonElement.querySelector('span')!.textContent = hasApprovedTemplate
        ? 'Enviar teste'
        : 'Aguardando template aprovado';
      showMessage('Configuração carregada.', true);
    } catch (error) {
      connectionElement.className = 'connection-chip disconnected';
      connectionElement.textContent = 'Meta não configurada';
      listElement.innerHTML = '<div class="meta-empty"><strong>Não foi possível consultar a Meta</strong><span>Confira as credenciais seguras do backend.</span></div>';
      templateSelectElement.innerHTML = '<option value="">Configuração indisponível</option>';
      templateSelectElement.disabled = true;
      sendButtonElement.disabled = true;
      showMessage(friendlyError(error));
    } finally {
      refreshElement.disabled = false;
      refreshElement.textContent = 'Atualizar status';
    }
  }

  refreshElement.addEventListener('click', () => {
    void loadWorkspace();
  });

  templateFormElement.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!templateFormElement.reportValidity()) {
      return;
    }

    const buttonLabel = createButtonElement.querySelector('span')!;
    const formData = new FormData(templateFormElement);
    createButtonElement.disabled = true;
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
      templateFormElement.reset();
      showMessage(`Template enviado à Meta com status ${statusLabel(result.status ?? 'PENDING')}.`, true);
      await loadWorkspace();
    } catch (error) {
      showMessage(friendlyError(error));
    } finally {
      createButtonElement.disabled = false;
      buttonLabel.textContent = 'Cadastrar template';
    }
  });

  sendFormElement.addEventListener('submit', async (event) => {
    event.preventDefault();

    if (!sendFormElement.reportValidity()) {
      return;
    }

    const selectedOption = templateSelectElement.selectedOptions[0];
    const language = selectedOption?.dataset.language ?? '';
    const formData = new FormData(sendFormElement);
    sendButtonElement.disabled = true;
    sendButtonElement.querySelector('span')!.textContent = 'Enviando…';
    showMessage('Solicitando o envio da mensagem de teste…');

    try {
      const response = await sendTestMessage({
        templateName: String(formData.get('templateName') ?? ''),
        language,
        recipient: String(formData.get('recipient') ?? ''),
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
      sendButtonElement.disabled = false;
      sendButtonElement.querySelector('span')!.textContent = 'Enviar teste';
    }
  });

  await loadWorkspace();
}
