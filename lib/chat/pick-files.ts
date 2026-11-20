/**
 * Open the OS file picker and return the chosen files.
 *
 * Do not set `accept` here. Qube accepts every file type (the server
 * normalizes attachments for the selected model), and WebKitGTK — the engine
 * behind Tauri's Linux desktop webview — converts each `accept` MIME type into
 * a GtkFileFilter. A wildcard that matches every MIME type is not a filter
 * GTK understands, so the filter matches nothing and every file in the dialog
 * is greyed out and unselectable. Leaving `accept` unset means "any file" and
 * lets the native dialog show normal, selectable files on every platform.
 */
export function pickFiles(options?: { multiple?: boolean }): Promise<File[]> {
  if (typeof document === "undefined") return Promise.resolve([]);

  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = options?.multiple ?? true;
    input.hidden = true;
    document.body.appendChild(input);

    let settled = false;
    const cleanup = () => {
      if (settled) return;
      settled = true;
      input.remove();
    };

    input.onchange = () => {
      const files = input.files ? Array.from(input.files) : [];
      cleanup();
      resolve(files);
    };
    // `cancel` keeps the input from leaking when the user dismisses the
    // native dialog (not supported by every webview, hence the onchange
    // cleanup above).
    input.oncancel = () => {
      cleanup();
      resolve([]);
    };

    input.click();
  });
}
