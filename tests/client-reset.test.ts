/**
 * Browser-side hard-reset coverage.
 *
 * The server removes files, but the webview keeps origin-scoped state.
 * This test exercises every store the client-reset module can reach.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clearClientStorageForHardReset } from "@/lib/system/client-reset";

describe("client hard reset", () => {
  it("clears localStorage, sessionStorage, cookies, IndexedDB, caches, and service workers", async () => {
    const calls: string[] = [];
    let cookie = "session=secret; theme=dark";

    const localStorageMock = {
      clear() {
        calls.push("localStorage");
      },
    };
    const sessionStorageMock = {
      clear() {
        calls.push("sessionStorage");
      },
    };
    const documentMock = {
      get cookie() {
        return cookie;
      },
      set cookie(value: string) {
        calls.push("cookie");
        cookie = value;
      },
    };
    const indexedDBMock = {
      databases: async () => [{ name: "qube-db" }, { name: "other-db" }],
      deleteDatabase(name: string) {
        const request: {
          onsuccess?: () => void;
          onerror?: () => void;
          onblocked?: () => void;
        } = {};
        queueMicrotask(() => {
          calls.push(`indexedDB:${name}`);
          request.onsuccess?.();
        });
        return request;
      },
    };
    const cachesMock = {
      keys: async () => ["qube-cache"],
      delete: async (name: string) => {
        calls.push(`cache:${name}`);
        return true;
      },
    };
    const serviceWorkerMock = {
      getRegistrations: async () => [
        {
          unregister: async () => {
            calls.push("serviceWorker");
            return true;
          },
        },
      ],
    };

    const globals = globalThis as Record<string, unknown>;
    globals.localStorage = localStorageMock;
    globals.sessionStorage = sessionStorageMock;
    globals.document = documentMock;
    globals.indexedDB = indexedDBMock;
    globals.caches = cachesMock;
    Object.defineProperty(globals, "navigator", {
      configurable: true,
      value: { serviceWorker: serviceWorkerMock },
    });

    await clearClientStorageForHardReset();

    assert.deepEqual(calls.sort(), [
      "cache:qube-cache",
      "cookie",
      "cookie",
      "cookie",
      "cookie",
      "indexedDB:other-db",
      "indexedDB:qube-db",
      "localStorage",
      "serviceWorker",
      "sessionStorage",
    ]);
    assert.match(cookie, /^theme=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=\/; SameSite=Lax$/);
  });
});
