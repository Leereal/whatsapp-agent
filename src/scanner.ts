import { callBackground } from "./bridge";
import { isReportable, readChatRows } from "./dom/chatList";
import type { ScanChatRow, ScanDecision, ScanResponse } from "./shared/contract";

/** Rows sent per request; the rest go on the next scan */
const MAX_ROWS = 50;

const signature = (row: ScanChatRow) =>
  JSON.stringify([row.unread_count, row.labels, row.last_activity]);

/**
 * Reports chat-list rows to the backend, but only rows that matter (labelled
 * or possible new leads) and only when something about them changed.
 */
export class ChatScanner {
  private readonly reported = new Map<string, string>();

  constructor(
    private readonly root: ParentNode,
    private readonly onDecisions: (decisions: ScanDecision[]) => void,
  ) {}

  /** The rows that would be reported now (changed since last time) */
  pending(labelNames: string[]): ScanChatRow[] {
    return readChatRows(this.root, labelNames)
      .filter(isReportable)
      .map(({ element: _element, ...row }) => row)
      .filter((row) => this.reported.get(row.title) !== signature(row))
      .slice(0, MAX_ROWS);
  }

  async scan(labelNames: string[]): Promise<void> {
    const chats = this.pending(labelNames);
    if (chats.length === 0) return;

    const response = await callBackground<ScanResponse>({ type: "scan", chats });
    for (const row of chats) this.reported.set(row.title, signature(row));
    this.onDecisions(response.decisions);
  }
}
