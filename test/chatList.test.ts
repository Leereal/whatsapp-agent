import { isReportable, parseRowTime, readChatRows } from "../src/dom/chatList";
import { normalizePhone } from "../src/phone";
import { loadFixture } from "./helpers";

// 28 Oct 2026, 22:00 local time
const now = new Date(2026, 9, 28, 22, 0);
const at = (hours: number, minutes: number, dayOffset = 0) =>
  new Date(2026, 9, 28 + dayOffset, hours, minutes).toISOString();

describe("readChatRows", () => {
  const rows = readChatRows(loadFixture("synthetic-logged-in.html"), ["New customer"], now);

  it("reads every visible row", () => {
    expect(rows.map((row) => row.title)).toEqual([
      "Thandi M",
      "+27 82 123 4567",
      "+27 71 000 5678",
    ]);
  });

  it("reads saved contacts without a phone number", () => {
    expect(rows[0]).toMatchObject({ phone: null, unread_count: 2, last_activity: at(21, 44) });
  });

  it("reads labels and treats day names as 'not today'", () => {
    expect(rows[1]).toMatchObject({
      phone: "+27821234567",
      labels: ["New customer"],
      unread_count: 0,
      last_activity: null,
    });
  });

  it("reads a possible new lead", () => {
    expect(rows[2]).toMatchObject({
      phone: "+27710005678",
      labels: [],
      unread_count: 1,
      last_activity: at(21, 50),
    });
  });

  it("matches labels case-insensitively but never from the title or message", () => {
    const shouting = readChatRows(loadFixture("synthetic-logged-in.html"), ["NEW CUSTOMER"], now);
    expect(shouting[1]?.labels).toEqual(["NEW CUSTOMER"]);
    const hours = readChatRows(loadFixture("synthetic-logged-in.html"), ["2 hours"], now);
    expect(hours.every((row) => row.labels.length === 0)).toBe(true);
  });
});

describe("isReportable", () => {
  const rows = readChatRows(loadFixture("synthetic-logged-in.html"), ["New customer"], now);

  it("reports labelled chats and unsaved numbers with unread messages only", () => {
    expect(rows.map(isReportable)).toEqual([false, true, true]);
  });
});

describe("parseRowTime", () => {
  it("reads today's clock times", () => {
    expect(parseRowTime("21:44", now)).toBe(at(21, 44));
    expect(parseRowTime("9:05 pm", now)).toBe(at(21, 5));
    expect(parseRowTime("12:15 AM", now)).toBe(at(0, 15));
  });

  it("puts a time later than now on the previous day", () => {
    expect(parseRowTime("23:10", now)).toBe(at(23, 10, -1));
  });

  it("returns null for anything that isn't a clock time", () => {
    for (const text of ["Yesterday", "Monday", "17/10/2026", "25:00", "soon"]) {
      expect(parseRowTime(text, now)).toBeNull();
    }
  });
});

describe("normalizePhone", () => {
  it("normalises WhatsApp's format and rejects names", () => {
    expect(normalizePhone("+27 71 000 5678")).toBe("+27710005678");
    expect(normalizePhone("071 000 5678")).toBe("+27710005678");
    expect(normalizePhone("Thandi M")).toBeNull();
  });
});
