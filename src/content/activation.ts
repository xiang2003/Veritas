import type { ActivateMessage } from '../lib/messages.ts';

/**
 * The content script stays dormant until the side panel (opened from the toolbar icon) asks it
 * to activate, so pages stay untouched and no API quota is spent until the user opts in.
 */
export function createActivation(start: () => void) {
  let started = false;
  return {
    get started() {
      return started;
    },
    /** @returns true if the message was an activation request (repeat requests are no-ops). */
    handle(message: unknown): boolean {
      if ((message as ActivateMessage | null)?.type !== 'activate') return false;
      if (!started) {
        started = true;
        start();
      }
      return true;
    },
  };
}
