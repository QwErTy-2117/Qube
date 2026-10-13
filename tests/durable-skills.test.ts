import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { materializeSkills, renderSkillsSection } from "@/lib/pi/durable-skills";

describe("durable skills section", () => {
  it("renders name+desc+path only, never body", () => {
    const out = renderSkillsSection([
      { name: "pdf-tools", description: "Extract text from PDFs. Use when reading PDFs.", path: "/skills/pdf-tools", instructions: "SECRET BODY" } as never,
    ]);
    assert.match(out, /pdf-tools/);
    assert.match(out, /Extract text from PDFs/);
    assert.doesNotMatch(out, /SECRET BODY/);
  });

  it("materializes SKILL.md files with real paths", () => {
    const base = mkdtempSync(join(tmpdir(), "qube-skills-test-"));
    const refs = materializeSkills(
      [{ name: "pdf-tools", description: "Extract text from PDFs. Use when reading PDFs.", instructions: "# PDF tools\nDo things.", source: "custom", installedAt: 1, updatedAt: 1 } as never],
      base,
    );
    assert.equal(refs.length, 1);
    const md = join(base, "pdf-tools", "SKILL.md");
    assert.ok(existsSync(md));
    const body = readFileSync(md, "utf-8");
    assert.match(body, /name: pdf-tools/);
    assert.match(body, /# PDF tools/);
    const out = renderSkillsSection(refs);
    assert.match(out, /pdf-tools/);
    assert.doesNotMatch(out, /# PDF tools/);
  });
});
