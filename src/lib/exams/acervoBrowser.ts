export const ACERVO_BROWSER_ORIGIN = 'https://questoes.colegioharmonia.com.br'

/** Check the actual HTTP framing policy before choosing a remote iframe. */
export function acervoBrowserAllowsFrame(headers: Headers, parentOrigin: string): boolean {
  const frameOptions = headers.get('x-frame-options')?.trim().toUpperCase()
  if (frameOptions === 'DENY' || (frameOptions === 'SAMEORIGIN' && parentOrigin !== ACERVO_BROWSER_ORIGIN)) return false
  for (const policy of (headers.get('content-security-policy') ?? '').split(',')) {
    const ancestors = policy.split(';').map((directive) => directive.trim().split(/\s+/)).find(([name]) => name?.toLowerCase() === 'frame-ancestors')
    if (!ancestors) continue
    const allowed = ancestors.slice(1)
    if (allowed.includes("'none'") || !allowed.some((source) => source === parentOrigin || source === '*' || (source === "'self'" && parentOrigin === ACERVO_BROWSER_ORIGIN))) return false
  }
  return true
}

/** School labels and the bank's subject facets use a few different names. */
export function acervoBrowserSubject(subject: string): string {
  const aliases: Record<string, string> = { Artes: 'Arte', Inglês: 'Língua Inglesa', Português: 'Língua Portuguesa' }
  return aliases[subject] ?? subject
}

/** A small read-only allowlist, never an arbitrary URL proxy. */
export function acervoBrowserPath(input: string): string | null {
  if (input.length > 2500 || !input.startsWith('/') || input.startsWith('//')) return null
  const url = new URL(input, ACERVO_BROWSER_ORIGIN)
  if (url.origin !== ACERVO_BROWSER_ORIGIN || !/^\/api\/painel\/(?:questions(?:\/\d+)?|stats|facets|tags)$/.test(url.pathname)) return null
  return url.pathname + url.search
}

/** The original bank runs in an opaque sandbox. Only public catalog reads cross the bridge. */
export function acervoBrowserDocument(html: string, script: string, subject = ''): string {
  const bridge = `
  const pendingReads = new Map(); let readSequence = 0;
  const bridgeImportStates = new Map();
  function applyImportState(button) {
    const state = bridgeImportStates.get(Number(button.dataset.importQuestion));
    const status = state?.status || 'available';
    const labels = { queued: 'Na fila…', importing: 'Importando…', imported: '✓ Adicionada à prova', error: 'Tentar novamente', available: 'Importar esta questão' };
    button.textContent = labels[status] || labels.available;
    button.disabled = ['queued', 'importing', 'imported'].includes(status);
    button.title = state?.message || '';
  }
  window.addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'acervo:import-status') return;
    const { questionId, status, message } = event.data;
    if (!Number.isSafeInteger(questionId) || !['queued', 'importing', 'imported', 'error', 'available'].includes(status)) return;
    bridgeImportStates.set(questionId, { status, message });
    document.querySelectorAll('[data-import-question]').forEach(applyImportState);
  });
  window.fetch = (url) => new Promise((resolve, reject) => {
    const parsed = new URL(String(url), '${ACERVO_BROWSER_ORIGIN}');
    if (parsed.origin !== '${ACERVO_BROWSER_ORIGIN}') return reject(new Error('Endereço inválido.'));
    const id = ++readSequence;
    const timeout = setTimeout(() => { pendingReads.delete(id); reject(new Error('A consulta demorou demais. Tente novamente.')); }, 25000);
    pendingReads.set(id, { resolve, reject, timeout });
    parent.postMessage({ type: 'acervo:read', id, path: parsed.pathname + parsed.search }, '*');
  });
  window.addEventListener('message', (event) => {
    if (event.source !== parent || event.data?.type !== 'acervo:response') return;
    const item = pendingReads.get(event.data.id); if (!item) return;
    clearTimeout(item.timeout); pendingReads.delete(event.data.id);
    item.resolve({ ok: event.data.ok, json: async () => event.data.body });
  });
  history.replaceState = () => {};
  document.addEventListener('click', event => {
    if (event.target.closest('a')) event.preventDefault();
    const selected = event.target.closest('[data-import-question]');
    if (selected && !selected.disabled) { parent.postMessage({ type: 'acervo:select', questionId: Number(selected.dataset.importQuestion) }, '*'); selected.closest('dialog')?.close(); }
  });
  document.addEventListener('DOMContentLoaded', () => {
    const results = document.getElementById('results');
    if (!results) return;
    const decorate = () => results.querySelectorAll('.question-card').forEach(card => {
      if (card.querySelector('[data-import-question]')) return;
      const original = card.querySelector('.open-question[data-id]'); if (!original) return;
      const button = document.createElement('button'); button.type = 'button';
      button.dataset.importQuestion = original.dataset.id; applyImportState(button);
      button.style.cssText = 'background:#176343;color:white;border:0;border-radius:8px;padding:12px;margin:12px;cursor:pointer;font-weight:600';
      card.appendChild(button);
    });
    new MutationObserver(decorate).observe(results, { childList: true }); decorate();
    const detail = document.getElementById('detail');
    if (detail) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Importar esta questão';
      button.style.cssText = 'background:#176343;color:white;border:0;border-radius:8px;padding:12px;margin:12px;cursor:pointer;font-weight:600';
      detail.appendChild(button);
      results.addEventListener('click', event => { const open = event.target.closest('.open-question[data-id]'); if (open) { detail.dataset.importId = open.dataset.id; button.dataset.importQuestion = open.dataset.id; applyImportState(button); } });
    }
  });`
  const safeInline = (value: string) => value.replace(/<\/script/gi, '<\\/script')
  const clean = html.replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace('<head>', `<head><base href="${ACERVO_BROWSER_ORIGIN}/"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${ACERVO_BROWSER_ORIGIN} 'unsafe-inline'; img-src ${ACERVO_BROWSER_ORIGIN} data:; font-src ${ACERVO_BROWSER_ORIGIN}; script-src 'unsafe-inline'; connect-src 'none'; form-action 'none'; frame-src 'none'">`)
  const filtered = script.replace('new URLSearchParams(location.search)', `new URLSearchParams(${JSON.stringify(new URLSearchParams(subject ? { disciplina: acervoBrowserSubject(subject) } : {}).toString())})`)
  return clean.replace('</body>', `<script>${safeInline(bridge)}</script><script>${safeInline(filtered)}</script></body>`)
}
