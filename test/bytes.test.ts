import { base64ToBytes, bytesToBase64, mimeFor } from "../src/bytes";

describe("base64", () => {
  it("round-trips bytes, including large files read in chunks", () => {
    const bytes = new Uint8Array(100_000).map((_, index) => index % 256);
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes);
    expect(bytesToBase64(new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer)).toBe("JVBERg==");
  });
});

describe("mimeFor", () => {
  it("uses the browser's type when it knows it", () => {
    expect(mimeFor("cv.pdf", "image/jpeg")).toBe("image/jpeg");
    expect(mimeFor("cv", "application/pdf; charset=binary")).toBe("application/pdf");
  });

  it("falls back to the file's extension", () => {
    expect(mimeFor("CV 2026.PDF", "")).toBe("application/pdf");
    expect(mimeFor("cv.docx", "application/octet-stream")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(mimeFor("notes", null)).toBe("application/octet-stream");
  });
});
