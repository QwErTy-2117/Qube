"use client";

import * as React from "react";
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp } from "lucide-react";
import { DayPicker } from "react-day-picker";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

/**
 * Day button owns all visible day states. DayPicker puts `selected`/`today`
 * classes on the surrounding <td>, which previously produced an unrounded
 * square behind a rounded button and let the hover fill fight the selection.
 * Keeping selection, today and hover on one rounded element makes the states
 * independent and the corners uniform.
 */
function CalendarDayButton({
  className,
  day: _day,
  modifiers,
  ...props
}: React.ComponentProps<"button"> & {
  day?: unknown;
  modifiers?: Record<string, boolean>;
}) {
  const ref = React.useRef<HTMLButtonElement>(null);
  React.useEffect(() => {
    if (modifiers?.focused) ref.current?.focus();
  }, [modifiers?.focused]);

  const selected = modifiers?.selected === true;
  const today = modifiers?.today === true;

  return (
    <button
      ref={ref}
      {...props}
      className={cn(
        buttonVariants({ variant: "ghost" }),
        "size-8 rounded-full p-0 font-normal transition-colors duration-150",
        selected
          ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground focus-visible:bg-primary focus-visible:text-primary-foreground"
          : today
            ? "bg-accent text-accent-foreground hover:bg-accent/80 hover:text-accent-foreground"
            : "hover:bg-accent hover:text-accent-foreground",
        className,
      )}
    />
  );
}

function Calendar({ className, classNames, showOutsideDays = true, ...props }: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("relative p-3", className)}
      classNames={{
        months: "flex flex-col sm:flex-row gap-2",
        month: "flex flex-col gap-4",
        month_caption: "flex justify-center pt-1 relative items-center w-full",
        caption_label: "text-sm font-medium",
        nav: "absolute inset-x-0 top-3 z-10 flex items-center justify-between px-3",
        button_previous: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 rounded-full bg-transparent p-0 opacity-60 hover:opacity-100",
        ),
        button_next: cn(
          buttonVariants({ variant: "outline" }),
          "size-7 rounded-full bg-transparent p-0 opacity-60 hover:opacity-100",
        ),
        chevron: "size-4",
        month_grid: "w-full border-collapse space-x-1",
        weekdays: "flex",
        weekday: "text-muted-foreground rounded-md w-8 font-normal text-[0.8rem]",
        week: "flex w-full mt-2",
        day: cn(
          "relative p-0 text-center text-sm focus-within:relative focus-within:z-20",
          "[&:has([aria-selected])]:bg-transparent",
        ),
        day_button: "size-8 rounded-full p-0 font-normal",
        // Keep every cell state on the button (CalendarDayButton), never the td.
        selected: "bg-transparent text-primary-foreground",
        today: "bg-transparent",
        outside: "day-outside text-muted-foreground/60",
        disabled: "text-muted-foreground opacity-50",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ className, orientation, ...props }) => {
          const Icon =
            orientation === "left"
              ? ChevronLeft
              : orientation === "right"
                ? ChevronRight
                : orientation === "up"
                  ? ChevronUp
                  : ChevronDown;
          return <Icon className={cn("size-4", className)} {...props} />;
        },
        DayButton: CalendarDayButton as never,
      }}
      {...props}
    />
  );
}

export { Calendar };
