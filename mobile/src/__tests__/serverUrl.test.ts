import { checkServerUrl, isPrivateHost } from "../serverUrl";

describe("isPrivateHost", () => {
  it.each(["10.0.2.2", "10.1.2.3", "127.0.0.1", "172.16.0.1", "172.31.255.255", "192.168.1.20", "localhost"])(
    "%s is private",
    (host) => expect(isPrivateHost(host)).toBe(true),
  );

  it.each(["172.15.0.1", "172.32.0.1", "8.8.8.8", "murilopreto.com.br", "192.169.0.1", "10.0.0", "256.1.1.1"])(
    "%s is not",
    (host) => expect(isPrivateHost(host)).toBe(false),
  );
});

describe("checkServerUrl", () => {
  it("accepts https in either build, dropping a trailing slash", () => {
    expect(checkServerUrl(" https://murilopreto.com.br/ ", "release")).toEqual({
      ok: true,
      url: "https://murilopreto.com.br",
    });
    expect(checkServerUrl("https://murilopreto.com.br", "lan").ok).toBe(true);
  });

  it("refuses plain http in the release build, even to a local address", () => {
    const result = checkServerUrl("http://192.168.1.20:5000", "release");
    expect(result.ok).toBe(false);
  });

  it("allows plain http to a local address in the LAN build, keeping the port", () => {
    expect(checkServerUrl("http://10.0.2.2:5000", "lan")).toEqual({
      ok: true,
      url: "http://10.0.2.2:5000",
    });
  });

  it("refuses plain http to a public address in the LAN build", () => {
    // Otherwise the LAN build would send the password unencrypted over the internet.
    expect(checkServerUrl("http://murilopreto.com.br", "lan").ok).toBe(false);
  });

  it.each(["", "murilopreto.com.br", "ftp://example.com", "https://example.com/api"])(
    "refuses %j",
    (input) => expect(checkServerUrl(input, "lan").ok).toBe(false),
  );
});
