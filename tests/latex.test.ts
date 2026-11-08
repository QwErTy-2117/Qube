/**
 * LaTeX + streaming text rendering regression tests.
 *
 * Covers:
 * - remark-math + rehype-katex rendering of $...$, $$...$$ and normalized
 *   \(...\) / \[...\] delimiters
 * - currency dollars survive preprocessing
 * - KaTeX CSS is loaded at the app root
 * - the old Unicode LaTeX shortcuts are gone
 * - streaming prose uses a per-word appear animation and no pulsing dot
 *
 * Run: npx tsx --test tests/latex.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";

const ROOT = process.cwd();

// Import the pure helpers directly: the package root pulls in the React
// primitive entry point, which leaves a handle open in `node --test`.
const { escapeCurrencyDollars, normalizeMathDelimiters } = (await import(
  pathToFileURL(
    join(ROOT, "node_modules/@assistant-ui/react-markdown/dist/preprocess.js"),
  ).href
)) as typeof import("@assistant-ui/react-markdown");
const read = (p: string) => readFile(join(ROOT, p), "utf-8");
const exists = (p: string) =>
  access(join(ROOT, p)).then(
    () => true,
    () => false,
  );

const preprocess = (text: string) =>
  escapeCurrencyDollars(normalizeMathDelimiters(text));

function renderMarkdown(markdown: string): string {
  return renderToStaticMarkup(
    React.createElement(ReactMarkdown, {
      remarkPlugins: [remarkMath],
      rehypePlugins: [rehypeKatex],
      children: preprocess(markdown) as any,
    } as any),
  );
}

describe("markdown preprocessing: model math delimiters", () => {
  it("rewrites \\(...\\) to inline dollar math", () => {
    assert.equal(preprocess("Area is \\(\\pi r^2\\) exactly."), "Area is $\\pi r^2$ exactly.");
  });

  it("rewrites \\[...\\] to display dollar math", () => {
    assert.equal(
      preprocess("Before\n\\[\\int_0^1 x\\,dx\\]\nAfter"),
      "Before\n$$\\int_0^1 x\\,dx$$\nAfter",
    );
  });

  it("rewrites custom [/math] and [/inline] tags", () => {
    assert.equal(preprocess("[/inline]a+b[/inline]"), "$a+b$");
    assert.equal(preprocess("[/math]a+b[/math]"), "$$a+b$$");
  });

  it("leaves currency amounts alone", () => {
    assert.equal(preprocess("It costs $5 today, or $19.99 with tax."), "It costs \\$5 today, or \\$19.99 with tax.");
    assert.ok(!preprocess("$$x^2$$").includes("\\$\\$"));
    assert.equal(preprocess("\\$5"), "\\$5");
  });
});

describe("KaTeX rendering", () => {
  it("renders inline math to KaTeX markup", () => {
    const html = renderMarkdown("The mass-energy relation is $E = mc^2$.");
    assert.ok(html.includes('class="katex"'), "expected KaTeX inline output");
    assert.ok(html.includes("katex-html"));
  });

  it("renders display math to KaTeX markup", () => {
    const html = renderMarkdown(
      "$$\n\\sum_{i=1}^{n} i = \\frac{n(n+1)}{2}\n$$",
    );
    assert.ok(html.includes("katex-display"), "expected KaTeX display output");
    assert.ok(html.includes("\\sum"), "expected command to survive parsing");
  });

  it("renders normalized bracket math", () => {
    const html = renderMarkdown("So \\(x^2 + y^2 = z^2\\).");
    assert.ok(html.includes('class="katex"'));
  });

  it("does not render currency as math", () => {
    const html = renderMarkdown("That will be $5.");
    assert.ok(!html.includes('class="katex"'), "currency must not become KaTeX");
    assert.ok(html.includes("$5"));
  });
});

describe("LaTeX wiring", () => {
  it("loads KaTeX styles at the app root", async () => {
    const layout = await read("app/layout.tsx");
    assert.ok(layout.includes('import "katex/dist/katex.min.css"'));
  });

  it("keeps display math scrollable inside the message column", async () => {
    const css = await read("app/globals.css");
    assert.ok(css.includes(".aui-md .katex-display"));
    assert.ok(css.includes("overflow-x: auto"));
  });

  it("uses remark-math, rehype-katex and assistant-ui preprocessing", async () => {
    const src = await read("components/assistant-ui/markdown-text.tsx");
    assert.ok(src.includes("remarkMath"));
    assert.ok(src.includes("rehypeKatex"));
    assert.ok(src.includes("normalizeMathDelimiters"));
    assert.ok(src.includes("escapeCurrencyDollars"));
    assert.ok(src.includes("StaticMarkdown"));
  });

  it("removes the old Unicode LaTeX shortcut renderer", async () => {
    assert.equal(await exists("components/assistant-ui/latex-shortcuts.ts"), false);
    const src = await read("components/assistant-ui/markdown-text.tsx");
    assert.ok(!src.includes("renderLatexShortcuts"));
    assert.ok(!src.includes("latex-shortcuts"));
  });
});

describe("streaming text: word appear animation", () => {
  it("no longer imports the pulsing-dot stylesheet", async () => {
    const [markdown, css] = await Promise.all([
      read("components/assistant-ui/markdown-text.tsx"),
      read("app/globals.css"),
    ]);
    assert.ok(!markdown.includes("styles/dot.css"));
    assert.ok(!css.includes("styles/dot.css"));
    assert.ok(!css.includes("aui-pulse"));
    assert.ok(!css.includes("\\25cf"));
  });

  it("streams prose via the smooth character animator, not per-word spans", async () => {
    const src = await read("components/assistant-ui/markdown-text.tsx");
    assert.ok(!src.includes("withWordAnimation"));
    assert.ok(!src.includes('className="aui-word"'));
    assert.ok(src.includes("smooth={{"));
  });

  it("keeps globals.css free of per-word animation keyframes", async () => {
    const css = await read("app/globals.css");
    assert.ok(!css.includes("aui-word"));
    assert.ok(!css.includes("@keyframes aui-word-in"));
    assert.ok(css.includes("smooth character animator"));
    assert.ok(css.includes("prefers-reduced-motion: reduce"));
  });
});
