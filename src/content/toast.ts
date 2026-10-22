const HIDE_AFTER_MS = 4000;

export interface Toast {
  update(message: string): void;
  /** Remove now, or after `delayMs`. */
  close(delayMs?: number): void;
}

/**
 * Small notice in the bottom-left page corner (bottom-right is used by Veritas' buttons and panels).
 * Transient by default; `persist` keeps it until closed, e.g. for "analysing…" progress.
 */
export function showToast(doc: Document, message: string, { persist = false } = {}): Toast {
  const host = doc.createElement('div');
  host.className = 'veritas-ui';
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.innerHTML = `<style>
    div { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; max-width: 320px; padding: 10px 14px;
      background: #1f2430; color: #fff; border-radius: 8px; font: 13px/1.4 system-ui, "Noto Sans TC", sans-serif;
      box-shadow: 0 4px 16px rgba(0,0,0,.3); }
  </style><div></div>`;
  const box = shadow.querySelector('div')!;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const toast: Toast = {
    update: (text) => (box.textContent = `Veritas：${text}`),
    close(delayMs = 0) {
      clearTimeout(timer);
      timer = setTimeout(() => host.remove(), delayMs);
    },
  };
  toast.update(message);
  doc.body.append(host);
  if (!persist) toast.close(HIDE_AFTER_MS);
  return toast;
}
