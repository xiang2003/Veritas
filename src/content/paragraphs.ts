/** Class on every element Veritas inserts into the page, so other passes (e.g. highlighting) can skip them. */
export const UI_CLASS = 'veritas-ui';
export const BUTTON_CLASS = 'veritas-tr-btn';
export const PANEL_CLASS = 'veritas-tr-panel';

const MIN_CHARS = 40; // skip captions, bylines and other short lines

export type Translator = (text: string) => Promise<string>;

function node<K extends keyof HTMLElementTagNameMap>(doc: Document, tag: K, className: string, text = '') {
  const el = doc.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function attach(p: HTMLElement, text: string, translate: Translator): void {
  const doc = p.ownerDocument;
  const button = node(doc, 'button', `${UI_CLASS} ${BUTTON_CLASS}`, '譯');
  button.type = 'button';
  button.title = '查看翻譯 / Translate';
  p.prepend(button);

  let panel: HTMLElement | undefined;
  let loaded = false;
  let loading = false;

  button.addEventListener('click', async (event) => {
    event.preventDefault();
    event.stopPropagation(); // the paragraph may sit inside a link on some sites
    if (panel && loaded) {
      panel.hidden = !panel.hidden;
      button.classList.toggle('open', !panel.hidden);
      return;
    }
    if (loading) return;
    if (!panel) {
      panel = node(doc, 'div', `${UI_CLASS} ${PANEL_CLASS}`);
      p.after(panel);
    }
    panel.hidden = false;
    panel.textContent = '翻譯中…';
    button.classList.add('open');
    loading = true;
    try {
      panel.textContent = await translate(text);
      loaded = true;
    } catch (error) {
      panel.textContent = `⚠ ${error instanceof Error ? error.message : String(error)}（再點一次重試）`;
    } finally {
      loading = false;
    }
  });
}

/**
 * Put a small "譯" button at the right of each paragraph; clicking it fetches the translation
 * and shows it below the paragraph (click again to hide). Safe to call repeatedly.
 * @returns number of buttons added
 */
export function attachTranslateButtons(root: Element, translate: Translator): number {
  let added = 0;
  for (const p of root.querySelectorAll<HTMLElement>('p')) {
    if (p.closest(`.${UI_CLASS}`) || p.querySelector(`:scope > .${BUTTON_CLASS}`)) continue;
    const text = (p.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (text.length < MIN_CHARS) continue;
    attach(p, text, translate);
    added++;
  }
  return added;
}
