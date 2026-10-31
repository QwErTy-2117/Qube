/**
 * Artifact routing + document sanitization tests.
 *
 * The viewers themselves are React components; what is unit-testable and
 * regression-prone is which viewer a file maps to, and the sanitizer that
 * stands between converted documents and dangerouslySetInnerHTML.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  detectArtifactKind,
  languageForPath,
  detectLanguageFromContent,
  formatBytes,
} from "@/lib/artifact/kinds";
import { parseDelimited } from "@/lib/artifact/delimited";
import {
  sanitizeHtml,
  htmlToBlocks,
  textToBlocks,
  escapeHtml,
} from "@/lib/artifact/sanitize-html";

describe("artifact kind detection", () => {
  it("routes document formats to the document viewer", () => {
    for (const file of ["notes.docx", "legacy.doc", "README.md", "memo.txt", "letter.rtf"]) {
      assert.equal(detectArtifactKind(file), "doc", file);
    }
  });

  it("routes spreadsheets to the sheet viewer", () => {
    for (const file of ["budget.xlsx", "old.xls", "data.csv", "tabs.tsv", "libre.ods"]) {
      assert.equal(detectArtifactKind(file), "sheet", file);
    }
  });

  it("routes presentations to the slides viewer", () => {
    for (const file of ["pitch.pptx", "old.ppt", "deck.odp"]) {
      assert.equal(detectArtifactKind(file), "slides", file);
    }
  });

  it("routes PDFs to the PDF viewer", () => {
    assert.equal(detectArtifactKind("contract.pdf"), "pdf");
  });

  it("routes HTML to its own side-panel kind, never the code viewer", () => {
    assert.equal(detectArtifactKind("page.html"), "html");
    assert.equal(detectArtifactKind("page.htm"), "html");
  });

  it("routes every required source language to the code viewer", () => {
    const files = [
      "a.js", "a.jsx", "a.ts", "a.tsx", "a.py", "a.rs", "a.go", "a.java",
      "a.c", "a.cpp", "a.cs", "a.css", "a.scss", "a.json", "a.yaml", "a.yml",
      "a.xml", "a.sql", "a.sh", "a.bash", "Dockerfile", "Makefile",
    ];
    for (const file of files) assert.equal(detectArtifactKind(file), "code", file);
  });

  it("is case-insensitive and handles directories", () => {
    assert.equal(detectArtifactKind("/tmp/Reports/Q3.PDF"), "pdf");
    assert.equal(detectArtifactKind("dir\\nested\\script.PY"), "code");
  });

  it("maps extensions to real shiki languages", () => {
    assert.equal(languageForPath("a.tsx"), "tsx");
    assert.equal(languageForPath("a.py"), "python");
    assert.equal(languageForPath("a.rs"), "rust");
    assert.equal(languageForPath("a.cs"), "csharp");
    assert.equal(languageForPath("a.scss"), "scss");
    assert.equal(languageForPath("a.sh"), "shellscript");
    assert.equal(languageForPath("a.unknown"), "text");
  });

  it("sniffs content when the extension says nothing", () => {
    assert.equal(detectLanguageFromContent("script", "#!/usr/bin/env python3\nprint(1)"), "python");
    assert.equal(detectLanguageFromContent("script", "#!/bin/bash\necho hi"), "shellscript");
    assert.equal(detectLanguageFromContent("data", '{"a": 1}'), "json");
  });

  it("formats byte sizes", () => {
    assert.equal(formatBytes(0), "0 B");
    assert.equal(formatBytes(2048), "2 KB");
    assert.equal(formatBytes(5 * 1024 * 1024), "5 MB");
  });
});

describe("CSV/TSV parsing", () => {
  it("handles quotes, escaped quotes and embedded newlines", () => {
    const rows = parseDelimited('a,b\n"x, y","line1\nline2"\n"he said ""hi""",z', ",");
    assert.deepEqual(rows, [
      ["a", "b"],
      ["x, y", "line1\nline2"],
      ['he said "hi"', "z"],
    ]);
  });

  it("uses the tab delimiter for TSV", () => {
    assert.deepEqual(parseDelimited("a\tb\n1\t2", "\t"), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("parses CRLF files", () => {
    assert.deepEqual(parseDelimited("a,b\r\n1,2\r\n", ","), [
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("document HTML sanitization", () => {
  it("removes scripts, iframes and inline event handlers", () => {
    const dirty = '<p onclick="alert(1)">Hi</p><script>alert(1)</script><iframe src="x"></iframe>';
    const clean = sanitizeHtml(dirty);
    assert.doesNotMatch(clean, /script/i);
    assert.doesNotMatch(clean, /iframe/i);
    assert.doesNotMatch(clean, /onclick/i);
    assert.match(clean, /Hi/);
  });

  it("blocks javascript: links but keeps http links", () => {
    const clean = sanitizeHtml('<a href="javascript:alert(1)">bad</a><a href="https://example.com">ok</a>');
    assert.doesNotMatch(clean, /javascript:/i);
    assert.match(clean, /https:\/\/example\.com/);
    assert.match(clean, /rel="noreferrer noopener"/);
  });

  it("keeps structural document markup", () => {
    const clean = sanitizeHtml("<h1>Title</h1><p>Body</p><table><tr><td>cell</td></tr></table>");
    assert.match(clean, /<h1>Title<\/h1>/);
    assert.match(clean, /<td>cell<\/td>/);
  });

  it("strips unknown elements but keeps their text", () => {
    assert.match(sanitizeHtml("<marquee>text</marquee>"), /text/);
  });

  it("splits converted documents into blocks and escapes plain text", () => {
    const blocks = htmlToBlocks("<h1>Heading</h1><p>One</p><ul><li>a</li><li>b</li></ul>");
    assert.equal(blocks.length, 3);
    const textBlocks = textToBlocks("# Title\n\nBody <script>bad</script>");
    assert.equal(textBlocks[0], "<h1>Title</h1>");
    assert.doesNotMatch(textBlocks.join(""), /<script>/);
    assert.equal(escapeHtml('<a href="x">'), "&lt;a href=&quot;x&quot;&gt;");
  });

  it("never emits an empty page list for whitespace-only input", () => {
    assert.deepEqual(textToBlocks("   \n\n "), []);
  });
});
