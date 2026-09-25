import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { chatColumnCenter } from "../components/updater/chat-anchor";

function docWithViewport(rect: { left: number; top: number; width: number; height: number } | null): Document {
  const dom = new JSDOM(`<html><body><div data-slot="aui_thread-viewport"></div></body></html>`);
  const doc = dom.window.document;
  if (rect) {
    const el = doc.querySelector('[data-slot="aui_thread-viewport"]')!;
    (el as any).getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top, toJSON: () => ({}) });
  } else {
    doc.querySelector('[data-slot="aui_thread-viewport"]')!.remove();
  }
  return doc as unknown as Document;
}

describe("chat-anchor: popups center on the chat column", () => {
  it("uses the thread viewport center, not the window center", () => {
    // Full window 1600 wide, chat column occupies 200..1100 (panel open right).
    const center = chatColumnCenter(docWithViewport({ left: 200, top: 0, width: 900, height: 800 }), 1600);
    assert.equal(center, 650);
  });
  it("falls back to half the given width without a viewport", () => {
    assert.equal(chatColumnCenter(docWithViewport(null), 1600), 800);
  });
  it("returns null when nothing is measurable", () => {
    assert.equal(chatColumnCenter(docWithViewport(null)), null);
  });
  it("ignores zero-width viewports", () => {
    assert.equal(chatColumnCenter(docWithViewport({ left: 0, top: 0, width: 0, height: 0 }), 1200), 600);
  });
});
