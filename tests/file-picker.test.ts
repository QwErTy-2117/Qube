import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { pickFiles } from "../lib/chat/pick-files";

// pickFiles reads the global `document` at call time, so each test installs a
// fresh JSDOM window and restores the previous globals afterwards.
let dom: JSDOM | undefined;
let previousDocument: unknown;
let previousHTMLElement: unknown;

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`);
  previousDocument = (globalThis as any).document;
  previousHTMLElement = (globalThis as any).HTMLElement;
  (globalThis as any).document = dom.window.document;
  (globalThis as any).HTMLElement = dom.window.HTMLElement;
  // jsdom's click() fires a click event but does not open a native dialog;
  // make it a no-op so the test controls the input directly.
  dom.window.HTMLInputElement.prototype.click = function () {};
});

afterEach(() => {
  (globalThis as any).document = previousDocument;
  (globalThis as any).HTMLElement = previousHTMLElement;
  dom?.window.close();
  dom = undefined;
});

function fileInput(): HTMLInputElement {
  const input = dom!.window.document.querySelector<HTMLInputElement>(
    'input[type="file"]',
  );
  assert.ok(input, "picker adds a file input to the document");
  return input;
}

function selectFiles(input: HTMLInputElement, files: File[]) {
  // `files` is read-only on a real FileList; the helper only reads it.
  Object.defineProperty(input, "files", { value: files, configurable: true });
  input.dispatchEvent(new dom!.window.Event("change"));
}

function cancel(input: HTMLInputElement) {
  input.dispatchEvent(new dom!.window.Event("cancel"));
}

describe("pickFiles: native file picker", () => {
  it("does not set an accept filter", async () => {
    // WebKitGTK (Tauri on Linux) turns accept MIME types into GtkFileFilter
    // entries; a wildcard like */* matches nothing and greys out every file.
    const pending = pickFiles();
    const input = fileInput();
    assert.equal(input.getAttribute("accept"), null);
    assert.equal(input.type, "file");
    assert.equal(input.multiple, true);
    cancel(input);
    assert.deepEqual(await pending, []);
  });

  it("resolves the selected files and removes the input", async () => {
    const pending = pickFiles({ multiple: true });
    const input = fileInput();
    const report = new dom!.window.File(["report"], "report.txt", {
      type: "text/plain",
    }) as unknown as File;
    const sheet = new dom!.window.File(["a,b"], "data.xyz", {
      type: "application/x-unknown",
    }) as unknown as File;

    selectFiles(input, [report, sheet]);

    const files = await pending;
    assert.deepEqual(
      files.map((f) => f.name),
      ["report.txt", "data.xyz"],
    );
    assert.equal(
      dom!.window.document.querySelector('input[type="file"]'),
      null,
      "input is cleaned up after selection",
    );
  });

  it("resolves an empty list and cleans up when the dialog is cancelled", async () => {
    const pending = pickFiles();
    const input = fileInput();

    cancel(input);

    assert.deepEqual(await pending, []);
    assert.equal(dom!.window.document.querySelector('input[type="file"]'), null);
  });

  it("supports single-file picking", async () => {
    const pending = pickFiles({ multiple: false });
    const input = fileInput();
    assert.equal(input.multiple, false);
    cancel(input);
    await pending;
  });
});

describe("pickFiles: non-browser environments", () => {
  it("resolves an empty list when there is no document", async () => {
    (globalThis as any).document = undefined;
    assert.deepEqual(await pickFiles(), []);
  });
});
