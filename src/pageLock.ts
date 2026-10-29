/**
 * One automated action at a time: sending and reading both open chats in the
 * same WhatsApp Web page, so they must never overlap.
 */
export class PageLock {
  private held = false;

  get busy(): boolean {
    return this.held;
  }

  /** Runs the work, or returns null at once when something else holds the page */
  async run<T>(work: () => Promise<T>): Promise<T | null> {
    if (this.held) return null;
    this.held = true;
    try {
      return await work();
    } finally {
      this.held = false;
    }
  }
}
