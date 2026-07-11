interface WindowInfo {
  title: string;
  pid: number;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, msg: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const result = await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(msg)), ms);
    }),
  ]);
  clearTimeout(timer);
  return result;
}

class ComputerManager {
  private static instance: ComputerManager;
  private focusedWindow: string | null = null;

  static getInstance(): ComputerManager {
    if (!ComputerManager.instance) {
      ComputerManager.instance = new ComputerManager();
    }
    return ComputerManager.instance;
  }

  async screenshot(windowTitle?: string): Promise<{ base64: string; width: number; height: number }> {
    if (windowTitle) {
      try {
        const { getWindows } = await import("@nut-tree-fork/nut-js");
        const windows = await getWindows();
        const titles = await Promise.all(windows.map((w) => w.title));
        const idx = titles.findIndex((t) =>
          t.toLowerCase().includes(windowTitle.toLowerCase()),
        );
        if (idx >= 0) {
          await windows[idx].focus();
        }
      } catch {
        // Focus is best-effort
      }
    }

    const screenshot = (await import("screenshot-desktop")).default;
    const pngBuffer = await withTimeout(
      screenshot({ format: "png" }),
      15000,
      "Screenshot timed out after 15s",
    );
    const { width, height } = this.getPngDimensions(pngBuffer);
    return { base64: pngBuffer.toString("base64"), width, height };
  }

  private getPngDimensions(buf: Buffer): { width: number; height: number } {
    if (buf.length < 24) return { width: 0, height: 0 };
    return {
      width: buf.readUInt32BE(16),
      height: buf.readUInt32BE(20),
    };
  }

  async click(x: number, y: number, button: "left" | "right" | "middle" = "left") {
    const { mouse, Button } = await import("@nut-tree-fork/nut-js");
    await mouse.setPosition({ x, y });
    const btnMap = { left: Button.LEFT, right: Button.RIGHT, middle: Button.MIDDLE };
    await mouse.click(btnMap[button]);
  }

  async type(text: string) {
    const { keyboard } = await import("@nut-tree-fork/nut-js");
    await keyboard.type(text);
  }

  async pressKey(keys: string) {
    const { keyboard, Key } = await import("@nut-tree-fork/nut-js");
    const parts = keys.toLowerCase().split("+").map((k) => k.trim());
    const keyMap: Record<string, any> = {
      "ctrl": Key.LeftControl,
      "alt": Key.LeftAlt,
      "shift": Key.LeftShift,
      "meta": Key.LeftWin,
      "enter": Key.Enter,
      "tab": Key.Tab,
      "escape": Key.Escape,
      "backspace": Key.Backspace,
      "delete": Key.Delete,
      "up": Key.Up,
      "down": Key.Down,
      "left": Key.Left,
      "right": Key.Right,
      "space": Key.Space,
      "home": Key.Home,
      "end": Key.End,
      "pageup": Key.PageUp,
      "pagedown": Key.PageDown,
    };
    const nutKeys = parts.map((p) => keyMap[p] || p);
    await keyboard.pressKey(...nutKeys);
  }

  async moveMouse(x: number, y: number) {
    const { mouse } = await import("@nut-tree-fork/nut-js");
    await mouse.setPosition({ x, y });
  }

  async scroll(x: number, y: number, direction: "up" | "down" | "left" | "right", amount: number) {
    const { mouse } = await import("@nut-tree-fork/nut-js");
    await mouse.setPosition({ x, y });
    for (let i = 0; i < amount; i++) {
      if (direction === "up") await mouse.scrollUp(1);
      else if (direction === "down") await mouse.scrollDown(1);
      else if (direction === "left") await mouse.scrollLeft(1);
      else await mouse.scrollRight(1);
    }
  }

  async drag(fromX: number, fromY: number, toX: number, toY: number) {
    const { mouse, Button } = await import("@nut-tree-fork/nut-js");
    await mouse.setPosition({ x: fromX, y: fromY });
    await mouse.pressButton(Button.LEFT);
    await mouse.setPosition({ x: toX, y: toY });
    await mouse.releaseButton(Button.LEFT);
  }

  async listWindows(): Promise<WindowInfo[]> {
    try {
      const { getWindows } = await import("@nut-tree-fork/nut-js");
      const windows = await withTimeout(getWindows(), 10000, "listWindows timed out");
      const titles = await Promise.all(windows.map((w) => w.title));
      return windows
        .filter((_, i) => titles[i] && titles[i].trim().length > 0)
        .map((_w, i) => ({
          title: titles[i],
          pid: 0,
        }));
    } catch {
      return [];
    }
  }

  async focusWindow(titlePattern: string): Promise<boolean> {
    try {
      const { getWindows } = await import("@nut-tree-fork/nut-js");
      const windows = await getWindows();
      const titles = await Promise.all(windows.map((w) => w.title));
      const idx = titles.findIndex((t) =>
        t.toLowerCase().includes(titlePattern.toLowerCase()),
      );
      if (idx >= 0) {
        await windows[idx].focus();
        this.focusedWindow = titles[idx];
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }
}

export const computerManager = ComputerManager.getInstance();
