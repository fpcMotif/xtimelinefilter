/**
 * Serializes tab-scoped badge writes and binds each content publish to the
 * document that sent it. A tab id survives navigation; a document id does not.
 */

export interface BadgeSender {
  tab?: { id?: number };
  frameId?: number;
  documentId?: string;
}

export interface BadgePresentation {
  text: string;
  backgroundColor?: string;
}

export interface TabBadgeWriterApi {
  currentTopDocumentId(tabId: number): Promise<string | undefined>;
  write(tabId: number, presentation: BadgePresentation): Promise<void>;
}

/**
 * A document-scoped, per-tab badge writer.
 *
 * `webNavigation.onCommitted` clears the badge after a document changes. A
 * queued old-document publish therefore either precedes that clear or fails
 * its document check. No worker-global document cache is correctness state.
 */
export class TabBadgeWriter {
  #tails = new Map<number, Promise<void>>();

  constructor(private readonly api: TabBadgeWriterApi) {}

  /** Publish only when the sender is still the tab's current top document. */
  publish(sender: BadgeSender, presentation: BadgePresentation): void {
    const tabId = sender.tab?.id;
    const documentId = sender.documentId;
    if (tabId === undefined || sender.frameId !== 0 || !documentId) return;

    this.#enqueue(tabId, async () => {
      const currentDocumentId = await this.api.currentTopDocumentId(tabId);
      if (currentDocumentId !== documentId) return;
      await this.api.write(tabId, presentation);
    });
  }

  /** Invalidate any document-scoped presentation for this tab. */
  clear(tabId: number): void {
    this.#enqueue(tabId, () => this.api.write(tabId, { text: "" }));
  }

  #enqueue(tabId: number, work: () => Promise<void>): void {
    // Stored tails always end in a swallowing .catch, and Promise.resolve() never
    // rejects, so `previous` always fulfils — no recovery catch is needed before work.
    const previous = this.#tails.get(tabId) ?? Promise.resolve();
    const next = previous.then(work).catch(() => {});
    this.#tails.set(tabId, next);
    void next.finally(() => {
      if (this.#tails.get(tabId) === next) this.#tails.delete(tabId);
    });
  }
}
