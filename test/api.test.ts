import { api } from "../src/api";
import { installToken } from "../src/storage";

const answer = (status: number, body: unknown = null) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(body === null ? "Bad Gateway" : JSON.stringify(body), { status })),
  );

describe("api", () => {
  beforeEach(() => installToken.setValue("cvp_wa_test"));
  afterEach(() => vi.unstubAllGlobals());

  it("treats the proxy's answer for a backend that is down as offline", async () => {
    answer(502);
    await expect(api.getConfig()).rejects.toMatchObject({ kind: "offline", status: 502 });
  });

  it("reports the backend's own errors as server errors", async () => {
    answer(500, { success: false, error: { message: "Something broke" } });
    await expect(api.getConfig()).rejects.toMatchObject({
      kind: "server",
      message: "Something broke",
    });
  });
});
