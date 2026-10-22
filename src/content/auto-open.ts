import { UI_CLASS } from './paragraphs.ts';

/**
 * Chrome only opens the side panel in response to a user gesture, so the panel cannot pop up on
 * page load. The closest thing: open it on the learner's first click or key press on the article.
 * If Chrome still refuses, offer a button – clicking it is an unambiguous gesture.
 */
export function installAutoOpen(doc: Document, open: () => Promise<boolean>): void {
  let done = false;

  const onGesture = (event: Event) => {
    if (done || (event.target as Element | null)?.closest?.(`.${UI_CLASS}`)) return;
    done = true;
    doc.removeEventListener('click', onGesture, true);
    doc.removeEventListener('keydown', onGesture, true);
    void open().then((opened) => opened || showOpenButton(doc, open), () => showOpenButton(doc, open));
  };
  // Capture phase: runs inside the gesture even if the page stops propagation.
  doc.addEventListener('click', onGesture, true);
  doc.addEventListener('keydown', onGesture, true);
}

export function showOpenButton(doc: Document, open: () => Promise<boolean>): HTMLElement {
  const host = doc.createElement('div');
  host.className = UI_CLASS;
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    button { all: unset; position: fixed; right: 16px; bottom: 16px; z-index: 2147483646; cursor: pointer;
      padding: 10px 16px; border-radius: 999px; background: #4f46e5; color: #fff;
      font: 600 14px/1.4 system-ui, "Noto Sans TC", sans-serif; box-shadow: 0 6px 20px rgba(0,0,0,.25); }
  </style><button type="button">💬 開啟 AI 教練</button>`;
  shadow.querySelector('button')!.addEventListener('click', async () => {
    if (await open().catch(() => false)) host.remove();
  });
  doc.body.append(host);
  return host;
}
