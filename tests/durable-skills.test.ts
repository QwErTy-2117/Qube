import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderSkillsSection } from "@/lib/pi/durable-skills";

describe("durable skills section", () => {
  it("renders name+desc+path only, never body", () => {
    const out = renderSkillsSection([
      { name: "pdf-tools", description: "Extract text from PDFs. Use when reading PDFs.", path: "/skills/pdf-tools", instructions: "SECRET BODY" } as never,
    ]);
    assert.match(out, /pdf-tools/);
    assert.match(out, /Extract text from PDFs/);
    assert.doesNotMatch(out, /SECRET BODY/);
  });
});
