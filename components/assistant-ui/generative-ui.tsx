"use client";

import {
  MessagePrimitive,
  type GenerativeUIComponentRegistry,
  type ToolCallMessagePartComponent,
  useAui,
} from "@assistant-ui/react";
import { Children, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { GenerativeUISpec } from "@/lib/generative-ui/catalog";
import { StaticMarkdown } from "./markdown-text";
import { ToolRow } from "./tools/tool-row";
import { friendlyToolLabel } from "./tools/tool-labels";

function asString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return undefined;
}

function asNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return Math.min(max, Math.max(min, Math.round(asNumber(value, fallback))));
}

function gapClass(value: unknown): string {
  const gap = clampInt(value, 0, 8, 3);
  return (
    {
      0: "gap-0",
      1: "gap-1",
      2: "gap-2",
      3: "gap-3",
      4: "gap-4",
      5: "gap-5",
      6: "gap-6",
      7: "gap-7",
      8: "gap-8",
    } as Record<number, string>
  )[gap]!;
}

function textSize(value: unknown): string {
  const size = asString(value);
  if (size === "sm") return "text-sm";
  if (size === "lg") return "text-base";
  return "text-sm";
}

function textWeight(value: unknown): string {
  const weight = asString(value);
  if (weight === "light") return "font-light";
  if (weight === "medium") return "font-medium";
  if (weight === "semibold") return "font-semibold";
  if (weight === "bold") return "font-bold";
  return "font-normal";
}

function nodeText(value: unknown, children?: ReactNode): string {
  return asString(value) ?? (typeof children === "string" ? children : "");
}

function GenUICard({
  title,
  subtitle,
  children,
}: {
  title?: unknown;
  subtitle?: unknown;
  children?: ReactNode;
}) {
  const heading = asString(title);
  const sub = asString(subtitle);
  return (
    <section className="my-2 overflow-hidden rounded-xl border border-border/60 bg-background">
      {(heading || sub) && (
        <div className="border-b border-border/40 px-4 py-3">
          {heading && <h3 className="text-sm font-semibold text-foreground">{heading}</h3>}
          {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
        </div>
      )}
      <div className="space-y-3 p-4">{children}</div>
    </section>
  );
}

function GenUIHeader({ text, size }: { text?: unknown; size?: unknown }) {
  const label = asString(text);
  if (!label) return null;
  const sizeClass =
    asString(size) === "sm"
      ? "text-sm"
      : asString(size) === "lg"
        ? "text-lg"
        : "text-base";
  return <h4 className={cn("font-semibold text-foreground", sizeClass)}>{label}</h4>;
}

function GenUIText({
  value,
  size,
  weight,
  muted,
  children,
}: {
  value?: unknown;
  size?: unknown;
  weight?: unknown;
  muted?: unknown;
  children?: ReactNode;
}) {
  const body = nodeText(value, children);
  const hasNested = Children.count(children) > 0 && !body;
  if (hasNested) return <div className="space-y-2">{children}</div>;
  if (!body) return null;
  return (
    <p
      className={cn(
        "leading-6",
        textSize(size),
        textWeight(weight),
        muted === true ? "text-muted-foreground" : "text-foreground",
      )}
    >
      {body}
    </p>
  );
}

function GenUICaption({ value, children }: { value?: unknown; children?: ReactNode }) {
  const body = nodeText(value, children);
  if (!body) return null;
  return <p className="text-xs leading-5 text-muted-foreground">{body}</p>;
}

function GenUIMarkdown({ value, children }: { value?: unknown; children?: ReactNode }) {
  const body = nodeText(value, children);
  if (!body) return null;
  return <StaticMarkdown text={body} className="text-sm" />;
}

function GenUIFact({ label, value }: { label?: unknown; value?: unknown }) {
  const key = asString(label);
  const val = asString(value);
  if (!key && !val) return null;
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-lg bg-muted/40 px-3 py-2">
      {key && <dt className="text-xs text-muted-foreground">{key}</dt>}
      {val && <dd className="text-sm font-semibold text-foreground">{val}</dd>}
    </div>
  );
}

function GenUIRow({ gap, children }: { gap?: unknown; children?: ReactNode }) {
  return (
    <div className={cn("flex flex-wrap", gapClass(gap))}>
      {Children.map(children, (child) => (
        <div className="min-w-0 flex-1">{child}</div>
      ))}
    </div>
  );
}

function GenUICol({ gap, children }: { gap?: unknown; children?: ReactNode }) {
  return <div className={cn("flex flex-col", gapClass(gap))}>{children}</div>;
}

function GenUIDivider() {
  return <hr className="my-1 border-border/50" />;
}

function GenUIBadge({ value, variant }: { value?: unknown; variant?: unknown }) {
  const label = asString(value);
  if (!label) return null;
  const tone = asString(variant);
  const toneClass =
    tone === "success"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
      : tone === "warning"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300"
        : tone === "danger"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : tone === "muted"
            ? "border-border/60 bg-muted text-muted-foreground"
            : "border-primary/25 bg-primary/10 text-primary";
  return (
    <span
      className={cn(
        "inline-flex w-fit items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
        toneClass,
      )}
    >
      {label}
    </span>
  );
}

function GenUITable({ columns, rows }: { columns?: unknown; rows?: unknown }) {
  const cols = Array.isArray(columns)
    ? columns.map((c) => asString(c) ?? asString((c as { label?: unknown })?.label) ?? "")
    : [];
  const body = Array.isArray(rows)
    ? rows.map((row) =>
        Array.isArray(row) ? row.map((cell) => asString(cell) ?? "") : [asString(row) ?? ""],
      )
    : [];
  const width = Math.max(cols.length, ...body.map((row) => row.length), 0);
  if (width === 0) return null;
  const headers = cols.length > 0 ? cols : Array.from({ length: width }, (_, i) => `Column ${i + 1}`);
  return (
    <div className="overflow-hidden rounded-lg border border-border/60">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-muted/50">
            <tr>
              {headers.map((header, i) => (
                <th key={i} className="border-b border-border/50 px-3 py-2 text-left font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-b border-border/40 last:border-b-0">
                {Array.from({ length: width }, (_, c) => (
                  <td key={c} className="px-3 py-2 text-muted-foreground">
                    {row[c] ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function GenUIChart({
  variant,
  data,
  title,
  unit,
  height,
}: {
  variant?: unknown;
  data?: unknown;
  title?: unknown;
  unit?: unknown;
  height?: unknown;
}) {
  const points = (Array.isArray(data) ? data : [])
    .map((item) => {
      const entry = item as { label?: unknown; value?: unknown };
      return {
        label: asString(entry?.label) ?? "",
        value: asNumber(entry?.value, Number.NaN),
      };
    })
    .filter((point) => Number.isFinite(point.value));
  if (points.length === 0) return null;

  const chartHeight = clampInt(height, 120, 320, 180);
  const width = 560;
  const padding = { top: 18, right: 12, bottom: 28, left: 12 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = chartHeight - padding.top - padding.bottom;
  const values = points.map((point) => point.value);
  const maxValue = Math.max(...values, 0);
  const minValue = Math.min(...values, 0);
  const range = maxValue - minValue || 1;
  const zeroY = padding.top + (maxValue / range) * plotHeight;
  const yFor = (value: number) => padding.top + ((maxValue - value) / range) * plotHeight;
  const isLine = asString(variant) === "line";
  const labelUnit = asString(unit);
  const heading = asString(title);

  return (
    <figure className="space-y-1.5">
      {heading && <figcaption className="text-xs font-medium text-muted-foreground">{heading}</figcaption>}
      <svg
        viewBox={`0 0 ${width} ${chartHeight}`}
        className="w-full text-primary"
        role="img"
        aria-label={heading || "Chart"}
      >
        <line
          x1={padding.left}
          x2={width - padding.right}
          y1={zeroY}
          y2={zeroY}
          className="stroke-border"
          strokeWidth={1}
        />
        {isLine ? (
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            points={points
              .map((point, i) => {
                const x = padding.left + (plotWidth / Math.max(points.length - 1, 1)) * i;
                return `${x},${yFor(point.value)}`;
              })
              .join(" ")}
          />
        ) : (
          points.map((point, i) => {
            const slot = plotWidth / Math.max(points.length, 1);
            const barWidth = slot * 0.58;
            const x = padding.left + slot * i + (slot - barWidth) / 2;
            const y = yFor(Math.max(point.value, 0));
            const barHeight = Math.max(zeroY - y, 1);
            return (
              <rect
                key={i}
                x={x}
                y={point.value >= 0 ? y : zeroY}
                width={barWidth}
                height={point.value >= 0 ? barHeight : Math.max(yFor(point.value) - zeroY, 1)}
                rx={3}
                fill="currentColor"
                opacity={0.85}
              />
            );
          })
        )}
        {isLine &&
          points.map((point, i) => {
            const x = padding.left + (plotWidth / Math.max(points.length - 1, 1)) * i;
            return <circle key={i} cx={x} cy={yFor(point.value)} r={3} fill="currentColor" />;
          })}
      </svg>
      <div className="flex justify-between gap-1 text-[10px] text-muted-foreground">
        {points.map((point, i) => (
          <span key={i} className="min-w-0 flex-1 truncate text-center">
            {point.label}
            {labelUnit ? ` · ${labelUnit}` : ""}
          </span>
        ))}
      </div>
    </figure>
  );
}

function GenUIAlert({
  title,
  description,
  tone,
}: {
  title?: unknown;
  description?: unknown;
  tone?: unknown;
}) {
  const heading = asString(title);
  const body = asString(description);
  if (!heading && !body) return null;
  const kind = asString(tone);
  const toneClass =
    kind === "success"
      ? "border-emerald-500/30 bg-emerald-500/10"
      : kind === "warning"
        ? "border-amber-500/30 bg-amber-500/10"
        : kind === "danger"
          ? "border-destructive/30 bg-destructive/10"
          : "border-primary/25 bg-primary/10";
  return (
    <div className={cn("rounded-lg border px-3 py-2", toneClass)}>
      {heading && <p className="text-sm font-semibold text-foreground">{heading}</p>}
      {body && <p className="mt-0.5 text-xs leading-5 text-muted-foreground">{body}</p>}
    </div>
  );
}

function GenUIButton({
  label,
  prompt,
  variant,
}: {
  label?: unknown;
  prompt?: unknown;
  variant?: unknown;
}) {
  const aui = useAui();
  const text = asString(label);
  const nextPrompt = asString(prompt);
  if (!text) return null;
  const kind = asString(variant);
  const toneClass =
    kind === "secondary"
      ? "border-border/70 bg-muted text-foreground hover:bg-muted/80"
      : kind === "outline"
        ? "border-border/70 bg-transparent text-foreground hover:bg-muted/50"
        : "border-primary bg-primary text-primary-foreground hover:bg-primary/90";
  return (
    <button
      type="button"
      disabled={!nextPrompt}
      onClick={() => {
        if (!nextPrompt) return;
        try {
          aui.thread().append({ content: [{ type: "text", text: nextPrompt }] } as never);
        } catch {}
      }}
      className={cn(
        "inline-flex w-fit items-center rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        toneClass,
      )}
    >
      {text}
    </button>
  );
}

/** The allowlist assistant-ui's built-in GenerativeUI primitive resolves. */
export const generativeUIComponents: GenerativeUIComponentRegistry = {
  Card: GenUICard,
  Header: GenUIHeader,
  Text: GenUIText,
  Caption: GenUICaption,
  Markdown: GenUIMarkdown,
  Fact: GenUIFact,
  Row: GenUIRow,
  Col: GenUICol,
  Divider: GenUIDivider,
  Badge: GenUIBadge,
  Table: GenUITable,
  Chart: GenUIChart,
  Alert: GenUIAlert,
  Button: GenUIButton,
};

export function GenerativeUIUnknownComponent({ component }: { component: string }) {
  return (
    <span className="inline-flex rounded-md bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      unknown visual: {component}
    </span>
  );
}

function parseToolPayload(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function specFrom(value: unknown): GenerativeUISpec | null {
  const payload = parseToolPayload(value);
  if (!payload || typeof payload !== "object") return null;
  const candidate =
    "spec" in payload ? (payload as { spec?: unknown }).spec : payload;
  if (!candidate || typeof candidate !== "object") return null;
  const root = (candidate as { root?: unknown }).root;
  if (root === undefined || root === null) return null;
  return candidate as GenerativeUISpec;
}

/**
 * Renders the model's `render_gui` tool call through assistant-ui's built-in
 * `MessagePrimitive.GenerativeUI`. The allowlist is the security boundary:
 * only the components above can render, with no eval or dynamic import.
 */
export const RenderGuiToolUI: ToolCallMessagePartComponent = ({ args, result, status }) => {
  const spec = specFrom(result) ?? specFrom(args);
  const running = (status as { type?: string } | undefined)?.type === "running";
  const verb = friendlyToolLabel("render_gui", args);

  if (!spec) {
    if (running) {
      return <ToolRow verb={verb} summary="Designing a visual…" status={status} />;
    }
    const payload = parseToolPayload(result) as { error?: unknown; note?: unknown } | null;
    const note =
      asString(payload?.error) ?? asString(payload?.note) ?? "No visual came back.";
    return <ToolRow verb={verb} summary={note.slice(0, 120)} status={status} />;
  }

  return (
    <div className="my-2 w-full" data-slot="aui-generative-ui">
      <MessagePrimitive.GenerativeUI
        spec={spec}
        components={generativeUIComponents}
        Fallback={GenerativeUIUnknownComponent}
      />
    </div>
  );
};
