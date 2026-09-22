import { httpsCallable, type Functions } from 'firebase/functions';

type EventKind = 'all' | 'message' | 'status';

interface WebhookEvent {
  id: string;
  kind: 'message' | 'status';
  messageId: string;
  status: string | null;
  recipient: string | null;
  errorMessage: string | null;
  from: string | null;
  contactName: string | null;
  messageType: string | null;
  content: Record<string, unknown>;
  eventTimestamp: number | null;
  receivedAt: number | null;
}

interface EventPage {
  events: WebhookEvent[];
  nextCursor: string | null;
}

const statusLabels: Record<string, string> = {
  sent: 'Enviado',
  delivered: 'Entregue',
  read: 'Lido',
  failed: 'Falhou',
  deleted: 'Apagado',
};

const messageTypeLabels: Record<string, string> = {
  text: 'Texto',
  image: 'Imagem',
  video: 'Vídeo',
  audio: 'Áudio',
  document: 'Documento',
  sticker: 'Figurinha',
  button: 'Botão',
  interactive: 'Resposta interativa',
  location: 'Localização',
  reaction: 'Reação',
  contacts: 'Contato',
};

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

function eventDate(event: WebhookEvent): string {
  const timestamp = event.eventTimestamp === null ? event.receivedAt : event.eventTimestamp * 1000;
  if (timestamp === null) return 'Horário não informado';
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? 'Horário não informado'
    : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'medium', timeStyle: 'medium' }).format(date);
}

function eventDetail(event: WebhookEvent): string {
  if (event.kind === 'status') {
    return event.errorMessage ?? 'Atualização de entrega recebida da Meta.';
  }

  const content = event.content ?? {};
  const text = stringValue(content.text) ?? stringValue(content.caption);
  if (text) return text;
  if (typeof content.latitude === 'number' && typeof content.longitude === 'number') {
    return `Localização: ${content.latitude}, ${content.longitude}`;
  }
  if (stringValue(content.emoji)) return `Reação: ${content.emoji}`;
  if (stringValue(content.replyId)) return `Resposta: ${content.replyId}`;
  if (stringValue(content.mediaId)) return `Mídia recebida · ID ${content.mediaId}`;
  return `Tipo: ${messageTypeLabels[event.messageType ?? ''] ?? event.messageType ?? 'desconhecido'}`;
}

function eventRow(event: WebhookEvent): HTMLElement {
  const row = document.createElement('article');
  row.className = `webhook-event-row webhook-event-${event.kind}`;
  row.innerHTML = `
    <div class="webhook-event-heading"><strong></strong><span></span></div>
    <div class="webhook-event-contact"><span>WhatsApp</span><strong></strong></div>
    <div class="webhook-event-id"><span>ID da mensagem</span><code></code></div>
    <p class="webhook-event-detail"></p>`;

  row.querySelector('.webhook-event-heading strong')!.textContent = event.kind === 'status'
    ? statusLabels[event.status ?? ''] ?? event.status ?? 'Status'
    : 'Mensagem recebida';
  row.querySelector('.webhook-event-heading span')!.textContent = eventDate(event);
  row.querySelector('.webhook-event-contact strong')!.textContent = event.kind === 'status'
    ? event.recipient ?? 'Não informado'
    : event.contactName
      ? `${event.contactName} · ${event.from ?? ''}`
      : event.from ?? 'Não informado';
  row.querySelector('.webhook-event-id code')!.textContent = event.messageId || '—';
  row.querySelector('.webhook-event-detail')!.textContent = eventDetail(event);
  return row;
}

export function webhookPanelTemplate(): string {
  return `
    <header class="dashboard-header meta-header webhook-page-header">
      <div>
        <span class="eyebrow"><i></i> Monitoramento</span>
        <h1>Eventos WhatsApp</h1>
        <p>Mensagens recebidas e atualizações de status do webhook.</p>
      </div>
      <a class="webhook-back-link" href="/painel/meta">Voltar à configuração Meta</a>
    </header>

    <section class="content-card webhook-events-card" aria-label="Eventos recebidos">
      <div class="webhook-events-toolbar">
        <strong id="webhook-total">Carregando…</strong>
        <label for="webhook-filter">Exibir</label>
        <select id="webhook-filter" aria-label="Filtrar eventos">
          <option value="all">Todos os eventos</option>
          <option value="message">Mensagens recebidas</option>
          <option value="status">Atualizações de status</option>
        </select>
        <button id="webhook-refresh" type="button">Atualizar</button>
      </div>
      <div id="webhook-events" class="webhook-events-list"></div>
      <div class="webhook-load-more"><button id="webhook-more" type="button" hidden>Carregar mais</button></div>
      <p id="webhook-feedback" class="page-message" role="status"></p>
    </section>`;
}

export async function bindWebhookPanel(functions: Functions): Promise<void> {
  const list = document.querySelector<HTMLDivElement>('#webhook-events');
  const total = document.querySelector<HTMLElement>('#webhook-total');
  const feedback = document.querySelector<HTMLParagraphElement>('#webhook-feedback');
  const filter = document.querySelector<HTMLSelectElement>('#webhook-filter');
  const refresh = document.querySelector<HTMLButtonElement>('#webhook-refresh');
  const more = document.querySelector<HTMLButtonElement>('#webhook-more');
  if (!list || !total || !feedback || !filter || !refresh || !more) {
    throw new Error('Tela de eventos do webhook incompleta.');
  }

  const getEvents = httpsCallable<{ kind: EventKind; cursor: string | null }, EventPage>(
    functions,
    'listMetaWebhookEvents',
  );
  let nextCursor: string | null = null;
  let loadedCount = 0;
  let loading = false;

  async function load(reset: boolean): Promise<void> {
    if (loading || (!reset && !nextCursor)) return;
    loading = true;
    const requestedKind = filter!.value as EventKind;
    if (reset) {
      list!.replaceChildren();
      nextCursor = null;
      loadedCount = 0;
      total!.textContent = 'Carregando…';
      more!.hidden = true;
    }
    feedback!.textContent = '';
    filter!.disabled = true;
    refresh!.disabled = true;
    more!.disabled = true;

    try {
      const result = await getEvents({ kind: requestedKind, cursor: nextCursor });
      for (const event of result.data.events) {
        list!.append(eventRow(event));
      }
      loadedCount += result.data.events.length;
      nextCursor = result.data.nextCursor;
      more!.hidden = nextCursor === null;
      const label = requestedKind === 'message'
        ? loadedCount === 1 ? 'mensagem recebida' : 'mensagens recebidas'
        : requestedKind === 'status'
          ? loadedCount === 1 ? 'status recebido' : 'status recebidos'
          : loadedCount === 1 ? 'evento carregado' : 'eventos carregados';
      total!.textContent = `${loadedCount} ${label}`;
      if (loadedCount === 0) {
        list!.innerHTML = '<p class="webhook-empty">Nenhum evento recebido desde a ativação deste acompanhamento.</p>';
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Erro inesperado.';
      feedback!.textContent = `Não foi possível carregar os eventos: ${detail}`;
      if (reset) total!.textContent = 'Erro ao carregar';
    } finally {
      loading = false;
      filter!.disabled = false;
      refresh!.disabled = false;
      more!.disabled = false;
    }
  }

  refresh.addEventListener('click', () => { void load(true); });
  filter.addEventListener('change', () => { void load(true); });
  more.addEventListener('click', () => { void load(false); });
  await load(true);
}
