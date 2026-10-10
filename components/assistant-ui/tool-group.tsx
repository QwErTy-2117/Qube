"use client";

import {
  memo,
  useCallback,
  useRef,
  useState,
  type FC,
  type PropsWithChildren,
} from "react";
import { ChevronDownIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { useScrollLock } from "@assistant-ui/react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { NumberRoll } from "./tools/number-roll";

const ANIMATION_DURATION = 200;

const toolGroupVariants = cva("aui-tool-group-root group/tool-group mt-2 w-full", {
  variants: {
    variant: {
      outline: "rounded-lg border py-3 mb-3",
      ghost: "mb-1",
    },
  },
  defaultVariants: { variant: "ghost" },
});

export type ToolGroupRootProps = Omit<
  React.ComponentProps<typeof Collapsible>,
  "open" | "onOpenChange"
> &
  VariantProps<typeof toolGroupVariants> & {
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    defaultOpen?: boolean;
  };

function ToolGroupRoot({
  className,
  variant,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  defaultOpen = false,
  children,
  ...props
}: ToolGroupRootProps) {
  const collapsibleRef = useRef<HTMLDivElement>(null);
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
  const lockScroll = useScrollLock(collapsibleRef, ANIMATION_DURATION);

  const isControlled = controlledOpen !== undefined;
  const isOpen = isControlled ? controlledOpen : uncontrolledOpen;

  const handleOpenChange = useCallback(
    (open: boolean) => {
      lockScroll();
      if (!isControlled) {
        setUncontrolledOpen(open);
      }
      controlledOnOpenChange?.(open);
    },
    [lockScroll, isControlled, controlledOnOpenChange],
  );

  return (
    <Collapsible
      ref={collapsibleRef}
      data-slot="tool-group-root"
      data-variant={variant ?? "ghost"}
      open={isOpen}
      onOpenChange={handleOpenChange}
      className={cn(
        toolGroupVariants({ variant }),
        "group/tool-group-root",
        className,
      )}
      style={
        {
          "--animation-duration": `${ANIMATION_DURATION}ms`,
        } as React.CSSProperties
      }
      {...props}
    >
      {children}
    </Collapsible>
  );
}

function ToolGroupTrigger({
  count,
  active = false,
  className,
  label: customLabel,
  detail: customDetail,
  icon,
  ...props
}: React.ComponentProps<typeof CollapsibleTrigger> & {
  count: number;
  active?: boolean;
  label?: string;
  detail?: string;
  icon?: React.ReactNode;
}) {
  // Screenshot style: bold verb + muted inline summary, subtle chevron.
  // Naming stays playful / non-technical (customLabel wins, else Activity).
  const displayLabel =
    customLabel || (active ? "Working…" : "Activity");

  return (
    <CollapsibleTrigger
      data-slot="tool-group-trigger"
      className={cn(
        "aui-tool-group-trigger group/trigger flex w-full origin-left items-baseline gap-2 py-1 text-left text-[15px] leading-relaxed transition-[color] active:scale-[0.998]",
        "text-foreground hover:text-foreground",
        className,
      )}
      {...props}
    >
      <span
        data-slot="tool-group-trigger-label"
        className="inline-flex min-w-0 items-baseline gap-2"
      >
        {icon && (
          <span
            data-slot="tool-group-trigger-icon"
            className="inline-flex size-4 shrink-0 translate-y-0.5 items-center justify-center self-center [&_svg]:size-4"
          >
            {icon}
          </span>
        )}
        <span className={cn("shrink-0 font-medium tracking-[-0.01em] text-foreground/90", active && "animate-pulse")}>
          {displayLabel}
        </span>
        {customDetail ? (
          <span className="min-w-0 truncate font-normal text-muted-foreground">
            {customDetail}
          </span>
        ) : count > 1 ? (
          <NumberRoll value={count} />
        ) : null}
      </span>
      <ChevronDownIcon
        data-slot="tool-group-trigger-chevron"
        className={cn(
          "size-3.5 shrink-0 self-center text-muted-foreground/50",
          "opacity-0 transition-[opacity,transform] duration-200 group-hover/trigger:opacity-100 group-data-[state=open]/trigger:opacity-100",
          "group-data-[state=closed]/trigger:-rotate-90",
          "group-data-[state=open]/trigger:rotate-0",
        )}
      />
    </CollapsibleTrigger>
  );
}

function ToolGroupContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof CollapsibleContent>) {
  return (
    <CollapsibleContent
      data-slot="tool-group-content"
      className={cn(
        "aui-tool-group-content relative overflow-hidden text-base outline-none",
        "group/collapsible-content ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:animate-none",
        "data-[state=closed]:animate-collapsible-up",
        "data-[state=open]:animate-collapsible-down",
        "data-[state=closed]:fill-mode-forwards",
        "data-[state=closed]:pointer-events-none",
        "data-[state=open]:duration-(--animation-duration)",
        "data-[state=closed]:duration-(--animation-duration)",
        className,
      )}
      {...props}
    >
      <div
        className={cn(
          "ml-5 flex flex-col gap-0.5 pt-0.5 pb-1",
          "[&_[data-slot=tool-row]]:mt-2",
          "[&>*]:animate-in [&>*]:fade-in-0 [&>*]:blur-in-[2px] [&>*]:slide-in-from-top-1 [&>*]:duration-(--animation-duration) [&>*]:ease-[cubic-bezier(0.32,0.72,0,1)]",
          "[&>*]:motion-reduce:animate-none",
          "[&>*:nth-child(2)]:[animation-delay:40ms]",
          "[&>*:nth-child(3)]:[animation-delay:80ms]",
          "[&>*:nth-child(4)]:[animation-delay:120ms]",
          "[&>*:nth-child(n+5)]:[animation-delay:160ms]",
        )}
      >
        {children}
      </div>
    </CollapsibleContent>
  );
}

type ToolGroupComponent = FC<
  PropsWithChildren<{ startIndex: number; endIndex: number }>
> & {
  Root: typeof ToolGroupRoot;
  Trigger: typeof ToolGroupTrigger;
  Content: typeof ToolGroupContent;
};

const ToolGroupImpl: FC<
  PropsWithChildren<{ startIndex: number; endIndex: number }>
> = ({ children, startIndex, endIndex }) => {
  const toolCount = endIndex - startIndex + 1;

  return (
    <ToolGroupRoot>
      <ToolGroupTrigger count={toolCount} />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
};

/**
 * @deprecated This wrapper targets the legacy `components.ToolGroup` prop
 * on `<MessagePrimitive.Parts>`. Use `<MessagePrimitive.GroupedParts>` with
 * a `groupBy` returning `"group-tool"` and compose `ToolGroupRoot` /
 * `ToolGroupTrigger` / `ToolGroupContent` directly. See `thread.tsx`.
 */
const ToolGroup = memo(ToolGroupImpl) as unknown as ToolGroupComponent;

ToolGroup.displayName = "ToolGroup";
ToolGroup.Root = ToolGroupRoot;
ToolGroup.Trigger = ToolGroupTrigger;
ToolGroup.Content = ToolGroupContent;

export {
  ToolGroup,
  ToolGroupRoot,
  ToolGroupTrigger,
  ToolGroupContent,
  toolGroupVariants,
};
