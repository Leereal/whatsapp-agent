import { BridgeError, warnUnlessOffline } from "../src/bridge";

describe("warnUnlessOffline", () => {
  afterEach(() => vi.restoreAllMocks());

  it("stays quiet when CareerCVPro or the background service is briefly out of reach", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnUnlessOffline(new BridgeError("Cannot reach CareerCVPro", "offline"));
    warnUnlessOffline(new BridgeError("No answer from the background service", "unavailable"));
    expect(warn).not.toHaveBeenCalled();
  });

  it("still logs other failures", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    warnUnlessOffline(new BridgeError("Server error", "server"));
    warnUnlessOffline(new Error("Something broke"));
    expect(warn).toHaveBeenCalledTimes(2);
  });
});
