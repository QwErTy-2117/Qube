"use client";

type DiffLine = {
  type: "add" | "del" | "context";
  content: string;
  lineNumber?: number;
};

function computeDiff(oldText: string, newText: string): DiffLine[] {
  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");
  const lines: DiffLine[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    if (i < oldLines.length && i < newLines.length) {
      if (oldLines[i] === newLines[i]) {
        lines.push({ type: "context", content: oldLines[i], lineNumber: i + 1 });
      } else {
        lines.push({ type: "del", content: oldLines[i], lineNumber: i + 1 });
        lines.push({ type: "add", content: newLines[i], lineNumber: i + 1 });
      }
    } else if (i < oldLines.length) {
      lines.push({ type: "del", content: oldLines[i], lineNumber: i + 1 });
    } else {
      lines.push({ type: "add", content: newLines[i], lineNumber: i + 1 });
    }
  }

  return lines;
}

export function DiffView({
  oldContent,
  newContent,
}: {
  oldContent: string;
  newContent: string;
}) {
  const lines = computeDiff(oldContent, newContent);

  return (
    <div className="overflow-auto rounded-md border border-border bg-background font-mono text-xs leading-5">
      <div className="flex border-b border-border bg-muted/50 px-3 py-1">
        <span className="text-muted-foreground">Diff</span>
      </div>
      <div className="p-0">
        {lines.map((line, i) => (
          <div
            key={i}
            className={`flex px-3 ${
              line.type === "add"
                ? "bg-green-50 text-green-800 dark:bg-green-950/30 dark:text-green-300"
                : line.type === "del"
                  ? "bg-red-50 text-red-800 dark:bg-red-950/30 dark:text-red-300"
                  : "text-muted-foreground"
            }`}
          >
            <span className="mr-4 w-8 shrink-0 text-right text-muted-foreground/50 select-none">
              {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
            </span>
            <span className="flex-1 whitespace-pre-wrap">{line.content}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
