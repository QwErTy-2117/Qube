/**
 * Attachment workspace persistence and visibility regression tests.
 *
 * Every attachment must be written into the workspace and described to the
 * model with its path, including images and PDFs that are also sent inline.
 * Text/Office/PDF content is extracted when possible; unsupported binaries
 * still get a workspace notice so the agent can inspect them with tools.
 */

import { after, before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let normalizeAttachmentsForModel: typeof import("@/lib/chat/attachment-model").normalizeAttachmentsForModel;
let workspace = "";

const PDF_BASE64 =
  "JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCA2MTIgNzkyXSAvUmVzb3VyY2VzIDw8IC9Gb250IDw8IC9GMSA1IDAgUiA+PiA+PiAvQ29udGVudHMgNCAwIFIgPj4KZW5kb2JqCjQgMCBvYmoKPDwgL0xlbmd0aCA0NSA+PgpzdHJlYW0KQlQgL0YxIDI0IFRmIDcyIDcyMCBUZCAoSGVsbG8gUXViZSBQREYpIFRqIEVUCmVuZHN0cmVhbQplbmRvYmoKNSAwIG9iago8PCAvVHlwZSAvRm9udCAvU3VidHlwZSAvVHlwZTEgL0Jhc2VGb250IC9IZWx2ZXRpY2EgPj4KZW5kb2JqCnhyZWYKMCA2CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDAwOSAwMDAwMCBuIAowMDAwMDAwMDU4IDAwMDAwIG4gCjAwMDAwMDAxMTUgMDAwMDAgbiAKMDAwMDAwMDI0MSAwMDAwMCBuIAowMDAwMDAwMzM2IDAwMDAwIG4gCnRyYWlsZXIKPDwgL1NpemUgNiAvUm9vdCAxIDAgUiA+PgpzdGFydHhyZWYKNDA2CiUlRU9GCg==";

function dataUrl(content: string | Uint8Array, mediaType: string): string {
  const bytes = typeof content === "string" ? Buffer.from(content) : Buffer.from(content);
  return `data:${mediaType};base64,${bytes.toString("base64")}`;
}

function messageWith(filename: string, mediaType: string, data: string): Array<Record<string, unknown>> {
  return [{
    role: "user",
    parts: [{ type: "file", filename, mediaType, data }],
  }];
}

function textParts(normalized: Array<Record<string, unknown>>): string {
  const parts = (normalized[0]?.parts as Array<Record<string, unknown>>) || [];
  return parts
    .filter((part) => part.type === "text")
    .map((part) => String(part.text || ""))
    .join("\n");
}

function fileParts(normalized: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  const parts = (normalized[0]?.parts as Array<Record<string, unknown>>) || [];
  return parts.filter((part) => part.type === "file");
}

function persistedPath(text: string): string {
  const match = /Saved for workspace tools at: (attachments\/[^\s]+)/.exec(text);
  assert.ok(match, `expected a workspace path in:\n${text}`);
  return match![1];
}

before(async () => {
  workspace = mkdtempSync(join(tmpdir(), "qube-attachment-workspace-"));
  process.env.WORKSPACE_PATH = workspace;
  ({ normalizeAttachmentsForModel } = await import("@/lib/chat/attachment-model"));
});

after(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("attachment workspace visibility", () => {
  it("saves a txt attachment and includes its content and path in the model message", async () => {
    const normalized = await normalizeAttachmentsForModel(
      messageWith("notes.txt", "text/plain", dataUrl("Quarterly numbers: 42\n", "text/plain")),
      { threadId: "txt-chat", persist: true },
    );
    const text = textParts(normalized);
    assert.match(text, /Quarterly numbers: 42/);
    assert.match(text, /Saved for workspace tools at: attachments\/txt-chat\//);
    const path = persistedPath(text);
    assert.equal(readFileSync(join(workspace, path), "utf8"), "Quarterly numbers: 42\n");
  });

  it("saves a pptx attachment and tells the agent where it is even without extracted text", async () => {
    const normalized = await normalizeAttachmentsForModel(
      messageWith(
        "deck.pptx",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        dataUrl("PK\u0003\u0004not-a-real-pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"),
      ),
      { threadId: "pptx-chat", persist: true },
    );
    const text = textParts(normalized);
    assert.match(text, /deck\.pptx/);
    assert.match(text, /Saved for workspace tools at: attachments\/pptx-chat\//);
    assert.match(text, /not sent inline to the model/i);
    assert.equal(fileParts(normalized).length, 0);
    assert.ok(existsSync(join(workspace, persistedPath(text))));
  });

  it("extracts PDF text by default and saves the original instead of sending it inline", async () => {
    const normalized = await normalizeAttachmentsForModel(
      messageWith("report.pdf", "application/pdf", `data:application/pdf;base64,${PDF_BASE64}`),
      { threadId: "pdf-chat", persist: true },
    );
    const text = textParts(normalized);
    assert.match(text, /Hello Qube PDF/);
    assert.match(text, /Saved for workspace tools at: attachments\/pdf-chat\//);
    assert.match(text, /extracted from the file/i);
    assert.equal(fileParts(normalized).length, 0);
    const bytes = readFileSync(join(workspace, persistedPath(text)));
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  });

  it("saves an image and keeps it inline only when the model supports images", async () => {
    const png = dataUrl("\u0089PNG\r\n\u001a\nfake", "image/png");
    const withoutVision = await normalizeAttachmentsForModel(
      messageWith("photo.png", "image/png", png),
      { threadId: "image-chat", persist: true, supportsImageInput: false },
    );
    assert.equal(fileParts(withoutVision).length, 0);
    const noVisionText = textParts(withoutVision);
    assert.match(noVisionText, /Saved for workspace tools at: attachments\/image-chat\//);
    assert.match(noVisionText, /not sent inline to the model/i);

    const withVision = await normalizeAttachmentsForModel(
      messageWith("photo.png", "image/png", png),
      { threadId: "image-chat", persist: true, supportsImageInput: true },
    );
    assert.equal(fileParts(withVision).length, 1);
    const visionText = textParts(withVision);
    assert.match(visionText, /Saved for workspace tools at: attachments\/image-chat\//);
    assert.match(visionText, /also included inline/i);
  });

  it("saves unknown binary types and tells the agent they are available in the workspace", async () => {
    const normalized = await normalizeAttachmentsForModel(
      messageWith("archive.bin", "application/octet-stream", dataUrl(Uint8Array.from([0, 1, 2, 3, 255]), "application/octet-stream")),
      { threadId: "binary-chat", persist: true },
    );
    const text = textParts(normalized);
    assert.match(text, /archive\.bin/);
    assert.match(text, /Saved for workspace tools at: attachments\/binary-chat\//);
    assert.ok(existsSync(join(workspace, persistedPath(text))));
  });
});
