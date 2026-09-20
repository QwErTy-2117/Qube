/**
 * Live marketplace helpers — pure units, no network.
 *
 * Run: QUBE_DATA_DIR=$(mktemp -d) npx tsx --test tests/live-marketplace.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  parseSkillMd,
  worstRisk,
  splitSkillId,
  liveHitToRow,
} from "@/lib/skills/live-marketplace";

describe("parseSkillMd", () => {
  it("extracts frontmatter name/description and strips it from instructions", () => {
    const md = `---\nname: pdf\ndescription: Handle PDF files.\n---\n\n# PDF Guide\n\nDo things.`;
    const out = parseSkillMd(md);
    assert.equal(out.name, "pdf");
    assert.equal(out.description, "Handle PDF files.");
    assert.ok(!out.instructions.includes("description:"), "frontmatter stripped");
    assert.match(out.instructions, /PDF Guide/);
  });

  it("falls back to H1 when frontmatter is missing", () => {
    const out = parseSkillMd(`# Research Helper\n\nSearch things.`);
    assert.equal(out.name, "");
    assert.equal(out.description, "Research Helper");
    assert.match(out.instructions, /Search things/);
  });

  it("handles quoted values and empty input", () => {
    const out = parseSkillMd(`---\nname: "my-skill"\ndescription: 'Does stuff.'\n---\nBody`);
    assert.equal(out.name, "my-skill");
    assert.equal(out.description, "Does stuff.");
    assert.deepEqual(parseSkillMd(""), { name: "", description: "", instructions: "" });
  });
});

describe("worstRisk", () => {
  it("maps scanner risks to safe/medium/excluded/unaudited", () => {
    assert.equal(worstRisk(["safe", "safe"]), "safe");
    assert.equal(worstRisk(["safe", "low"]), "safe");
    assert.equal(worstRisk(["safe", "medium"]), "medium");
    assert.equal(worstRisk(["high"]), "excluded");
    assert.equal(worstRisk(["safe", "critical"]), "excluded");
    assert.equal(worstRisk([]), "unaudited");
    assert.equal(worstRisk([undefined]), "unaudited");
    assert.equal(worstRisk(["unknown"]), "medium");
  });
});

describe("splitSkillId", () => {
  it("splits owner/repo/slug", () => {
    assert.deepEqual(splitSkillId("anthropics/skills/pdf"), {
      owner: "anthropics",
      repo: "skills",
      slug: "pdf",
    });
    assert.equal(splitSkillId("a/b"), null);
    assert.equal(splitSkillId(""), null);
  });
});

describe("liveHitToRow", () => {
  const hit = {
    id: "anthropics/skills/pdf",
    skillId: "pdf",
    name: "pdf",
    installs: 198589,
    source: "anthropics/skills",
  };

  it("builds a safe row with provenance", () => {
    const row = liveHitToRow(hit, { "anthropics/skills/pdf": { risk: "safe" } });
    assert.ok(row);
    assert.equal(row!.name, "pdf");
    assert.equal(row!.live, true);
    assert.equal(row!.safety?.risk, "safe");
    assert.equal(row!.installs, 198589);
    assert.equal(row!.detailId, "anthropics/skills/pdf");
    assert.match(row!.marketplaceUrl, /skills\.sh/);
  });

  it("excludes high/critical risks, keeps unaudited", () => {
    assert.equal(
      liveHitToRow(hit, { "anthropics/skills/pdf": { risk: "excluded" as never } }),
      null,
    );
    const unaudited = liveHitToRow(hit, {});
    assert.equal(unaudited?.safety?.risk, "unaudited");
  });

  it("sanitizes names to install-safe slugs", () => {
    const row = liveHitToRow({ ...hit, name: "My_Cool Skill!" }, {});
    assert.match(row!.name, /^[a-z0-9-]+$/);
  });
});
