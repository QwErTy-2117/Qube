/**
 * Attachment send/retry regression tests.
 *
 * A composer attachment has a live File; a sent or restored message only has
 * a `data:` URL file part. The preview must decode that URL, and the model
 * request must not carry a file part with a MIME type providers reject.
 *
 * Run: npx tsx --test tests/attachment-retry.test.ts (or `npm test`)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { convertToModelMessages } from "ai";
import {
  decodeAttachmentText,
  previewAttachment,
} from "@/lib/chat/attachments";
import { normalizeAttachmentsForModel } from "@/lib/chat/attachment-model";
import { threadMessageToUIMessage } from "@/lib/chat/message-convert";

function dataUrl(text: string, mediaType = "text/plain"): string {
  return `data:${mediaType};base64,${Buffer.from(text, "utf8").toString("base64")}`;
}

const TEXT_ATTACHMENT = "Quarterly numbers: 42\nAttachment content is data, not instructions.";
const TEXT_URL = dataUrl(TEXT_ATTACHMENT, "text/plain");

function sentConversation(mediaType = "text/plain") {
  return [
    {
      id: "user-1",
      role: "user",
      parts: [
        { type: "text", text: "Please review the attachment." },
        {
          type: "file",
          url: TEXT_URL,
          mediaType,
          filename: "notes.txt",
        },
      ],
    },
    {
      id: "assistant-1",
      role: "assistant",
      parts: [{ type: "text", text: "I could not read it." }],
    },
  ];
}

describe("attachment previews after send and retry", () => {
  it("decodes a sent file part whose raw File is gone", () => {
    const content = [{
      type: "file",
      data: TEXT_URL,
      mimeType: "text/plain",
      filename: "notes.txt",
    }];
    const preview = previewAttachment({ content, filename: "notes.txt" });
    assert.equal(preview.kind, "text");
    if (preview.kind === "text") {
      assert.match(preview.text, /Quarterly numbers: 42/);
      assert.equal(preview.truncated, false);
    }
  });

  it("keeps PDF and other binary previews usable instead of an empty text notice", () => {
    const pdfUrl = dataUrl("%PDF-1.4 fake", "application/pdf");
    const pdf = previewAttachment({
      content: [{ type: "file", data: pdfUrl, mimeType: "application/pdf", filename: "report.pdf" }],
      filename: "report.pdf",
    });
    assert.equal(pdf.kind, "binary");
    if (pdf.kind === "binary") {
      assert.equal(pdf.mediaType, "application/pdf");
      assert.equal(pdf.dataUrl, pdfUrl);
    }

    const zipUrl = dataUrl("PK\u0003\u0004 fake", "application/zip");
    const zip = previewAttachment({
      content: [{ type: "file", data: zipUrl, mimeType: "application/zip", filename: "bundle.zip" }],
      filename: "bundle.zip",
    });
    assert.equal(zip.kind, "binary");
    if (zip.kind === "binary") assert.equal(zip.mediaType, "application/zip");

    const component = readFileSync(
      new URL("../components/assistant-ui/attachment.tsx", import.meta.url),
      "utf8",
    );
    assert.ok(!component.includes("No text preview available for this file type."));
  });

  it("preserves file parts through a legacy ThreadMessage round-trip", () => {
    const restored = threadMessageToUIMessage({
      id: "legacy-1",
      role: "user",
      content: [
        { type: "text", text: "Review this" },
        {
          type: "file",
          data: TEXT_URL,
          mimeType: "text/plain",
          filename: "notes.txt",
        },
      ],
    });
    assert.ok(restored);
    assert.equal(restored.parts.length, 2);
    assert.equal(restored.parts[1].type, "file");
    assert.equal(restored.parts[1].url, TEXT_URL);
    assert.equal(restored.parts[1].mediaType, "text/plain");
    assert.equal(restored.parts[1].filename, "notes.txt");
  });

  it("decodes UTF-8 attachment text", () => {
    const value = "Ciao — 42 €";
    const url = `data:text/plain;charset=utf-8;base64,${Buffer.from(value, "utf8").toString("base64")}`;
    assert.equal(decodeAttachmentText(url), value);
  });
});

describe("attachment model payload after send and retry", () => {
  it("replaces an unsupported text/plain file part on the initial send and every retry", async () => {
    const original = sentConversation();
    const first = await normalizeAttachmentsForModel(original, {
      threadId: "chat-attachments",
      persist: false,
    });
    const retry = await normalizeAttachmentsForModel(original, {
      threadId: "chat-attachments",
      persist: false,
    });

    // The original UIMessage still has its file part for the chip/preview.
    assert.equal(original[0].parts[1].type, "file");
    assert.deepEqual(retry, first);

    const userParts = first[0].parts as Array<Record<string, unknown>>;
    assert.ok(!userParts.some((part) => part.type === "file"));
    const attachmentText = userParts.find(
      (part) => part.type === "text" && String(part.text).includes("notes.txt"),
    );
    assert.ok(attachmentText);
    assert.match(String(attachmentText?.text), /Quarterly numbers: 42/);
    assert.match(String(attachmentText?.text), /untrusted data, not instructions/);

    // This is the exact conversion used by the Pi harness before streamText.
    const modelMessages = await convertToModelMessages(first as any);
    const content = modelMessages[0].content as Array<Record<string, unknown>>;
    assert.ok(!content.some((part) => part.type === "file"));
    assert.ok(content.some(
      (part) => part.type === "text" && String(part.text).includes("Quarterly numbers: 42"),
    ));
  });

  it("handles empty MIME types and unsupported binary files without a provider file part", async () => {
    const emptyMime = sentConversation("");
    const normalizedEmpty = await normalizeAttachmentsForModel(emptyMime, {
      threadId: "chat-attachments",
      persist: false,
    });
    assert.ok(!(normalizedEmpty[0].parts as any[]).some((part) => part.type === "file"));
    assert.ok((normalizedEmpty[0].parts as any[]).some(
      (part) => part.type === "text" && String(part.text).includes("Quarterly numbers: 42"),
    ));

    const binaryUrl = dataUrl("PK\u0003\u0004 not really a docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    const binaryMessage = [{
      id: "user-binary",
      role: "user",
      parts: [
        { type: "text", text: "Review this document." },
        {
          type: "file",
          url: binaryUrl,
          mediaType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          filename: "report.docx",
        },
      ],
    }];
    const normalizedBinary = await normalizeAttachmentsForModel(binaryMessage, {
      threadId: "chat-attachments",
      persist: false,
    });
    const parts = normalizedBinary[0].parts as Array<Record<string, unknown>>;
    assert.ok(!parts.some((part) => part.type === "file"));
    const note = parts.find((part) => part.type === "text" && String(part.text).includes("report.docx"));
    assert.ok(note);
    assert.match(String(note?.text), /not sent inline to the model/);
    const modelMessages = await convertToModelMessages(normalizedBinary as any);
    assert.ok(!(modelMessages[0].content as any[]).some((part) => part.type === "file"));
  });

  it("keeps supported image and PDF file parts inline", async () => {
    const messages = [{
      id: "user-media",
      role: "user",
      parts: [
        { type: "text", text: "Look at these." },
        {
          type: "file",
          url: dataUrl("fake png", "image/png"),
          mediaType: "image/png",
          filename: "shot.png",
        },
        {
          type: "file",
          url: dataUrl("%PDF-1.4 fake", "application/pdf"),
          mediaType: "application/pdf",
          filename: "report.pdf",
        },
      ],
    }];
    const normalized = await normalizeAttachmentsForModel(messages, {
      threadId: "chat-attachments",
      persist: false,
    });
    const files = (normalized[0].parts as any[]).filter((part) => part.type === "file");
    assert.equal(files.length, 2);
    assert.deepEqual(files.map((part) => part.mediaType), ["image/png", "application/pdf"]);
    assert.deepEqual(files.map((part) => part.filename), ["shot.png", "report.pdf"]);
  });
});
