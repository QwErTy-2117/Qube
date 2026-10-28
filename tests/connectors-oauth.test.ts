import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { connectorCallbackUrl } from "../lib/connectors/oauth";
import { activeToolkitSlugs } from "../lib/connectors/account-status";
import { GET } from "../app/connectors/callback/route";

describe("connector OAuth browser hand-off", () => {
  it("uses the actual browser-reachable sidecar origin and marks desktop callbacks", () => {
    assert.equal(
      connectorCallbackUrl("http://localhost:3010/api/connectors/link", "http://127.0.0.1:49152", null, true),
      "http://127.0.0.1:49152/connectors/callback?mode=desktop",
    );
    assert.equal(
      connectorCallbackUrl("http://localhost:3010/api/connectors/link", null, "http://localhost:3010/settings", true),
      "http://localhost:3010/connectors/callback?mode=desktop",
    );
  });

  it("falls back from invalid origins and distinguishes web callbacks", () => {
    assert.equal(
      connectorCallbackUrl("https://qube.example/api/connectors/link", "null", "not a URL", false),
      "https://qube.example/connectors/callback?mode=web",
    );
  });

  for (const mode of ["desktop", "legacy"]) {
    it(`${mode} callback serves only a standalone native hand-off`, async () => {
      const query = mode === "legacy" ? "" : "?mode=desktop";
      const response = GET(new Request(`http://localhost:3010/connectors/callback${query}`));
      const html = await response.text();
      assert.match(html, /window\.location\.replace\("qube:\/\/connectors\/callback"\)/);
      assert.match(html, /href="qube:\/\/connectors\/callback"/);
      assert.doesNotMatch(html, /Connection complete|__next|<script src=/);
      assert.equal(response.headers.get("cache-control"), "no-store");
    });
  }

  it("web callbacks notify the original tab without launching the native app", async () => {
    const html = await GET(new Request("http://localhost:3010/connectors/callback?mode=web")).text();
    assert.match(html, /BroadcastChannel\("qube-connectors"\)/);
    assert.match(html, /window\.close\(\)/);
    assert.doesNotMatch(html, /qube:\/\//);
  });

  it("only reports active accounts as connected while authorization is pending", () => {
    const slugs = activeToolkitSlugs([
      { status: "INITIATED", toolkit: { slug: "gmail" } },
      { status: "FAILED", toolkit: { slug: "slack" } },
      { status: "ACTIVE", toolkit: { slug: "github" } },
      { status: "ACTIVE", app: "NOTION" },
      { status: "EXPIRED", app: "DROPBOX" },
    ]);
    assert.deepEqual([...slugs], ["github", "notion"]);
  });

  it("never reflects provider parameters into the callback document", async () => {
    const html = await GET(new Request("http://localhost:3010/connectors/callback?error=%3Cscript%3Ealert(1)%3C%2Fscript%3E")).text();
    assert.doesNotMatch(html, /alert\(1\)/);
  });
});
