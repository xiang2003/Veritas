import type { Recommendation } from '../lib/recommend.ts';
import { UI_CLASS } from './paragraphs.ts';

export const PICK_BADGE_CLASS = 'veritas-pick';

const STYLE = `
:host { all: initial; }
.wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; font: 14px/1.45 system-ui, "Noto Sans TC", sans-serif; }
.fab { all: unset; cursor: pointer; padding: 10px 16px; border-radius: 999px; background: #4f46e5; color: #fff;
  font-weight: 600; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
.fab:focus-visible { outline: 3px solid #a5b4fc; }
.panel { width: min(380px, calc(100vw - 32px)); max-height: 70vh; overflow-y: auto; margin-bottom: 10px; padding: 12px 14px;
  background: #fff; color: #1b1b1f; border: 1px solid #d0d4dc; border-radius: 12px; box-shadow: 0 10px 30px rgba(0,0,0,.2); }
.panel[hidden] { display: none; }
.head { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; }
.head strong { flex: 1; }
.head button { all: unset; cursor: pointer; padding: 2px 8px; border-radius: 6px; color: #6b7280; }
.head button:hover { background: #eef2ff; }
ol { margin: 0; padding: 0; list-style: none; display: grid; gap: 12px; }
a { color: inherit; font-weight: 600; text-decoration: none; }
a:hover { color: #4f46e5; text-decoration: underline; }
.meta { font-size: 12px; color: #4f46e5; font-weight: 600; }
.reason { font-size: 13px; color: #4b5563; margin-top: 2px; }
.status { color: #6b7280; }
.error { color: #dc2626; }
@media (prefers-color-scheme: dark) {
  .panel { background: #1f2430; color: #e8eaf0; border-color: #3a4152; }
  .reason, .status, .head button { color: #9aa3b5; }
  .head button:hover { background: #2c3347; }
}`;

const normalize = (href: string) => href.split(/[?#]/)[0];

function el<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className = '', text = '') {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Put a ⭐ badge (with the reason as tooltip) inside each page link that points at a pick. Idempotent. */
export function markPickedLinks(doc: Document, picks: Recommendation[]): number {
  const byUrl = new Map(picks.map((p) => [normalize(p.url), p]));
  let marked = 0;
  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href]')) {
    const pick = byUrl.get(normalize(a.href));
    if (!pick || a.querySelector(`.${PICK_BADGE_CLASS}`) || (a.textContent ?? '').trim().length < 10) continue;
    const badge = el(doc, 'span', `${UI_CLASS} ${PICK_BADGE_CLASS}`, '⭐ 推薦');
    badge.title = pick.reason;
    a.prepend(badge);
    marked++;
  }
  return marked;
}

export interface RecommendPanelDeps {
  /** Fetch picks; `force` skips the cache. */
  load: (force: boolean) => Promise<Recommendation[]>;
}

/** Floating "✨ 推薦文章" button that opens a list of recommended articles. */
export function createRecommendPanel(doc: Document, { load }: RecommendPanelDeps) {
  const host = el(doc, 'div', UI_CLASS);
  const shadow = host.attachShadow({ mode: 'open' });
  const style = el(doc, 'style');
  style.textContent = STYLE;

  const wrap = el(doc, 'div', 'wrap');
  const panel = el(doc, 'section', 'panel');
  panel.hidden = true;
  const head = el(doc, 'div', 'head');
  const refresh = el(doc, 'button', '', '↻');
  refresh.title = '重新推薦';
  const close = el(doc, 'button', '', '✕');
  close.title = '關閉';
  head.append(el(doc, 'strong', '', 'Veritas 推薦閱讀'), refresh, close);
  const body = el(doc, 'div');
  panel.append(head, body);
  const fab = el(doc, 'button', 'fab', '✨ 推薦文章');

  wrap.append(panel, fab);
  shadow.append(style, wrap);
  doc.body.append(host);

  let loaded = false;
  let loading = false;

  function render(picks: Recommendation[]) {
    const list = el(doc, 'ol');
    for (const pick of picks) {
      const item = el(doc, 'li');
      const meta = [pick.topic, pick.level].filter(Boolean).join(' · ');
      if (meta) item.append(el(doc, 'div', 'meta', meta));
      const link = el(doc, 'a', '', pick.title);
      link.href = pick.url;
      item.append(link);
      if (pick.reason) item.append(el(doc, 'div', 'reason', pick.reason));
      list.append(item);
    }
    body.replaceChildren(list);
  }

  async function fetchPicks(force: boolean) {
    if (loading) return;
    loading = true;
    body.replaceChildren(el(doc, 'div', 'status', '正在挑選值得讀的新聞…'));
    try {
      render(await load(force));
      loaded = true;
    } catch (error) {
      body.replaceChildren(el(doc, 'div', 'error', `⚠ ${error instanceof Error ? error.message : String(error)}`));
    } finally {
      loading = false;
    }
  }

  fab.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden && !loaded) void fetchPicks(false); // a failed load is retried on the next open
  });
  refresh.addEventListener('click', () => void fetchPicks(true));
  close.addEventListener('click', () => (panel.hidden = true));

  return { panel, fab, destroy: () => host.remove() };
}
