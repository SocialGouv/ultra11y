// The Docker tier and HOST loopback servers.
//
// `docker run` gets no `--network host`, by design — so a container's 127.0.0.1 is its
// own, and a scan of `http://localhost:3000` (the action's `start:` + `urls:` shape, the
// local-dev shape) died on ERR_CONNECTION_REFUSED while the app was running the whole
// time. The exact failure kept this repository's own CI red for a day: `runtime: auto`
// silently degraded to Docker, and the fallback tier could not reach the target the
// fallback existed to scan. A fallback that cannot reach the target is not a fallback.
import { describe, expect, it } from "vitest";

import { loopbackToHostGateway } from "../src/scan.js";

describe("loopbackToHostGateway", () => {
  it("rewrites loopback URLs to host.docker.internal and asks for the mapping", () => {
    expect(loopbackToHostGateway("http://127.0.0.1:8931/")).toEqual({
      url: "http://host.docker.internal:8931/",
      addHost: true,
    });
    expect(loopbackToHostGateway("http://localhost:3000/x")).toEqual({
      url: "http://host.docker.internal:3000/x",
      addHost: true,
    });
  });

  it("leaves remote URLs and file paths untouched", () => {
    expect(loopbackToHostGateway("https://example.com/")).toEqual({ url: "https://example.com/", addHost: false });
    expect(loopbackToHostGateway("/work/input.html")).toEqual({ url: "/work/input.html", addHost: false });
    expect(loopbackToHostGateway("https://localhost:8443/")).toEqual({ url: "https://localhost:8443/", addHost: false });
  });
});
