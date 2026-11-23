/**
 * Composio session allowlist regression tests.
 *
 * `sessions.create({ toolkits })` is a hard allowlist — any tool whose
 * toolkit is missing fails with
 * `[Session Restriction] Toolkit '<slug>' is not allowed for this session.`
 * Qube used to create one session per curated connector and merge their
 * helper tools, which left an arbitrary connector's narrow allowlist in
 * effect: Reddit, YouTube, and any app outside the curated map showed as
 * connected in Settings but every call was rejected.
 *
 * The session allowlist must therefore be the user's ACTIVE toolkits, not the
 * curated catalog.
 *
 * Run: npx tsx --test tests/connectors-session.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  COMPOSIO_TOOLKIT_MAP,
  sessionToolkitsForConnected,
} from "@/lib/connectors/composio";
import { getConnectorMetaForTool } from "@/lib/connectors/connector-meta";

describe("Composio session toolkit allowlist", () => {
  it("includes every connected toolkit, including apps outside the curated map", () => {
    assert.deepEqual(
      sessionToolkitsForConnected(["gmail", "reddit", "youtube"]),
      ["gmail", "reddit", "youtube"],
    );
  });

  it("is generic: toolkits Qube has never catalogued pass through untouched", () => {
    // Proof this is not a Reddit/YouTube special case: any toolkit with an
    // ACTIVE Composio connection (or added later to the Composio project)
    // lands in the session allowlist, curated or not.
    const connected = ["clickup", "googlephotos", "salesforce", "zendesk"];
    for (const slug of connected) {
      assert.equal(COMPOSIO_TOOLKIT_MAP[slug], undefined, `${slug} must not be curated`);
    }
    assert.deepEqual(sessionToolkitsForConnected(connected), [...connected].sort());
  });

  it("normalizes, dedupes, sorts, and ignores blanks", () => {
    assert.deepEqual(
      sessionToolkitsForConnected([" GMAIL ", "gmail", "", "  ", "Reddit"]),
      ["gmail", "reddit"],
    );
    assert.deepEqual(sessionToolkitsForConnected([]), []);
  });

  it("treats Reddit and YouTube as first-class catalog connectors", () => {
    assert.deepEqual(COMPOSIO_TOOLKIT_MAP.reddit, ["reddit"]);
    assert.deepEqual(COMPOSIO_TOOLKIT_MAP.youtube, ["youtube"]);
  });
});

describe("connector tool-card metadata", () => {
  it("labels Reddit and YouTube tool calls with their own cards", () => {
    assert.equal(getConnectorMetaForTool("REDDIT_SEARCH_POSTS")?.displayId, "reddit");
    assert.equal(getConnectorMetaForTool("YOUTUBE_LIST_VIDEOS")?.displayId, "youtube");
  });
});
