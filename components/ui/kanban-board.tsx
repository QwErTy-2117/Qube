"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { Check } from "lucide-react"

/* ═══════════════════════════════════════════════════════════════════════
   DESIGN TOKENS — exact cult-ui kanban-board tokens
   ═══════════════════════════════════════════════════════════════════════ */

const COLUMN_META = {
  todo: {
    icon: (
      <svg
        aria-hidden="true"
        fill="none"
        height="13"
        stroke="#b0b0b0"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
        viewBox="0 0 24 24"
        width="13"
      >
        <circle cx="12" cy="12" r="10" />
      </svg>
    ),
  },
  "in-progress": {
    icon: (
      <svg
        aria-hidden="true"
        fill="none"
        height="13"
        stroke="#f59e0b"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
        viewBox="0 0 24 24"
        width="13"
      >
        <circle cx="12" cy="12" r="10" />
        <polyline points="12 6 12 12 16 14" />
      </svg>
    ),
  },
  done: {
    icon: (
      <svg
        aria-hidden="true"
        fill="none"
        height="13"
        stroke="#10b981"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.2"
        viewBox="0 0 24 24"
        width="13"
      >
        <circle cx="12" cy="12" r="10" />
        <path d="m9 12 2 2 4-4" />
      </svg>
    ),
  },
}

export type ColumnStatus = keyof typeof COLUMN_META

export type CardData = {
  id: string
  title: string
  /** Backend truth: the task actually ran. Drives the status circle. */
  done?: boolean
}

export type ColumnData = {
  id: ColumnStatus
  title: string
  status: ColumnStatus
  cards: CardData[]
}

export type DragState = {
  cardId: string
  fromColumn: ColumnStatus
} | null

type CardProps = {
  card: CardData
  isDone: boolean
  index: number
  onDragStart: (e: React.DragEvent<HTMLDivElement>) => void
  onDragEnd: () => void
  isDragging: boolean
  /** Done-column cards are locked: backend truth only, no manual dragging. */
  locked?: boolean
  /** In-progress column: yellow spinning ring instead of the outline ring. */
  spinning?: boolean
  /** Queued card newly risen into view: enters from further below. */
  enterFromBelow?: boolean
  /** Overflow beyond the Done cap: slides right and disappears. */
  vanish?: boolean
  onVanished?: (id: string) => void
}

type DropIndicatorProps = {
  isActive: boolean
}

export type ColumnProps = {
  column: ColumnData
  onDrop: (
    cardId: string,
    fromColumnId: ColumnStatus,
    toColumnId: ColumnStatus
  ) => void
  dragState: DragState
  setDragState: React.Dispatch<React.SetStateAction<DragState>>
  /** Fired when an overflow Done card finishes sliding out — parent
      permanently deletes it. */
  onCardGone?: (cardId: string) => void
}

const springTransition = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
}
export const gentleSpring = {
  type: "spring" as const,
  stiffness: 300,
  damping: 26,
}

/* ═══════════════════════════════════════════════════════════════════════
   STATUS CIRCLE — thick ring, filled check when done (no badges, no image)
   ═══════════════════════════════════════════════════════════════════════ */

function StatusCircle({ done, spinning }: { done: boolean; spinning?: boolean }) {
  if (done) {
    return (
      <span
        aria-hidden="true"
        className="flex size-[18px] shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white"
      >
        <Check className="size-3" strokeWidth={3.5} />
      </span>
    )
  }
  if (spinning) {
    return (
      <span
        aria-hidden="true"
        className="block size-[18px] shrink-0 animate-spin rounded-full border-[2.5px] border-amber-500 border-t-transparent"
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      className="block size-[18px] shrink-0 rounded-full border-[2.5px] border-border"
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   CARD — cult-ui container, title + status circle only
   ═══════════════════════════════════════════════════════════════════════ */

const cardVariants = {
  initial: { opacity: 0, y: 8, scale: 0.97, filter: "blur(4px)" },
  animate: { opacity: 1, y: 0, scale: 1, filter: "blur(0px)" },
  exit: { opacity: 0, y: -6, scale: 0.98, filter: "blur(3px)" },
}

function Card({
  card,
  isDone,
  index,
  onDragStart,
  onDragEnd,
  isDragging,
  locked,
  spinning,
  enterFromBelow,
  vanish,
  onVanished,
}: CardProps) {
  const shouldReduce = useReducedMotion()
  // Circle shows the task's own state (backend truth), not the column:
  // a pending task dragged to another column keeps its outline ring, a
  // completed task keeps its filled check.
  const taskDone = card.done ?? isDone

  const containerStyle = {
    borderRadius: 14,
    background: "var(--muted)",
    padding: "8px 10px",
  } as const

  // Overflow card: slides to the right and disappears, then unmounts.
  if (vanish) {
    return (
      <motion.div
        animate={{ x: 160, opacity: 0 }}
        className="not-prose flex select-none flex-row items-start gap-2"
        initial={{ x: 0, opacity: 1 }}
        onAnimationComplete={() => onVanished?.(card.id)}
        style={{
          ...containerStyle,
          boxShadow:
            "0 0 0 1px var(--border), 0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.03)",
          position: "relative",
        }}
        transition={{ type: "spring" as const, stiffness: 260, damping: 24 }}
      >
        <span className="pt-[1px]">
          <StatusCircle done={taskDone} />
        </span>
        <div
          className="min-w-0 flex-1 font-semibold text-[11.5px] leading-snug"
          style={{ color: "var(--foreground)", textWrap: "pretty" }}
        >
          {card.title}
        </div>
      </motion.div>
    )
  }

  return (
    <motion.div
      animate="animate"
      className={
        locked
          ? "not-prose flex select-none flex-row items-start gap-2"
          : "not-prose flex cursor-grab select-none flex-row items-start gap-2 active:cursor-grabbing"
      }
      draggable={!locked}
      exit="exit"
      initial={
        enterFromBelow
          ? { opacity: 0, y: 44, scale: 0.97, filter: "blur(4px)" }
          : "initial"
      }
      layout
      layoutId={card.id}
      onDragEnd={onDragEnd}
      // NOTE: motion types onDragStart as its pan handler; the arrow
      // forwards the native HTML5 drag event (with dataTransfer).
      onDragStart={(e: any) => onDragStart(e as React.DragEvent<HTMLDivElement>)}
      style={{
        ...containerStyle,
        boxShadow: isDragging
          ? "0 0 0 1px var(--border), 0 12px 32px rgba(0,0,0,0.18), 0 4px 8px rgba(0,0,0,0.10)"
          : "0 0 0 1px var(--border), 0 1px 2px rgba(0,0,0,0.04), 0 2px 6px rgba(0,0,0,0.03)",
        opacity: isDone && !isDragging ? 0.5 : 1,
        position: "relative",
        zIndex: isDragging ? 50 : 1,
      }}
      transition={{
        ...gentleSpring,
        delay: shouldReduce ? 0 : index * 0.05,
        layout: springTransition,
      }}
      variants={cardVariants}
      whileHover={{
        y: -2,
        boxShadow:
          "0 0 0 1px var(--border), 0 4px 12px rgba(0,0,0,0.10), 0 2px 4px rgba(0,0,0,0.06)",
        transition: { type: "spring", stiffness: 400, damping: 20 },
      }}
      whileTap={{ scale: 0.97 }}
    >
      <span className="pt-[1px]">
        <StatusCircle done={taskDone} spinning={spinning} />
      </span>
      {/* Title only — `div` avoids `.prose p` margins when embedded in MDX/docs */}
      <div
        className="min-w-0 flex-1 font-semibold text-[11.5px] leading-snug"
        style={{
          color: "var(--foreground)",
          textDecoration: isDone ? "line-through" : "none",
          textDecorationColor: isDone ? "var(--muted-foreground)" : undefined,
          textWrap: "pretty",
        }}
      >
        {card.title}
      </div>
    </motion.div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   DROP INDICATOR
   ═══════════════════════════════════════════════════════════════════════ */

function DropIndicator({ isActive }: DropIndicatorProps) {
  return (
    <motion.div
      animate={{
        opacity: isActive ? 1 : 0,
        scaleX: isActive ? 1 : 0.3,
      }}
      className="pointer-events-none mx-auto"
      initial={false}
      style={{
        height: 3,
        width: "60%",
        borderRadius: 99,
        background:
          "linear-gradient(90deg, transparent, rgba(59,130,246,0.4), transparent)",
        marginTop: 2,
        marginBottom: 2,
      }}
      transition={{ type: "spring", stiffness: 500, damping: 28 }}
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════
   COLUMN
   ═══════════════════════════════════════════════════════════════════════ */

export function Column({
  column,
  onDrop,
  dragState,
  setDragState,
  onCardGone,
}: ColumnProps) {
  const [dragOver, setDragOver] = useState(false)
  const meta = COLUMN_META[column.status] || COLUMN_META.todo
  const isDone = column.status === "done"
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Done is backend-truth only: capped at 5 visible, extras slide out.
  // To do shows the top 7; the rest queue up and rise from the bottom
  // as space frees.
  const DONE_VISIBLE = 5
  const TODO_VISIBLE = 7
  const isTodo = column.status === "todo"
  const [vanishedIds, setVanishedIds] = useState<string[]>([])
  const liveCards = column.cards.filter((c) => !vanishedIds.includes(c.id))
  const cap = isDone ? DONE_VISIBLE : isTodo ? TODO_VISIBLE : liveCards.length
  const visibleCards = liveCards.slice(0, cap)
  const overflowCards = isDone ? liveCards.slice(cap) : []
  const queuedCount = liveCards.length - visibleCards.length - overflowCards.length

  // Staged refill for To do: when a card leaves, the rest slide up first
  // and the next queued card is held back briefly, then rises from the
  // bottom. The "+N more" line stays hidden until the sequence completes.
  const [shownIds, setShownIds] = useState<Set<string>>(
    () => new Set(column.cards.slice(0, TODO_VISIBLE).map((c) => c.id))
  )
  const targetIds = visibleCards.map((c) => c.id)
  const holdingBack =
    isTodo && targetIds.some((id) => !shownIds.has(id))
  const displayedCards = isTodo
    ? visibleCards.filter((c) => shownIds.has(c.id))
    : visibleCards
  const targetKey = targetIds.join(",")
  useEffect(() => {
    if (!isTodo) return
    const newcomers = targetIds.filter((id) => !shownIds.has(id))
    if (newcomers.length === 0) return
    const t = setTimeout(() => {
      setShownIds((prev) => {
        const next = new Set(prev)
        newcomers.forEach((id) => next.add(id))
        return next
      })
    }, 380)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isTodo, targetKey])

  // Ids that newly appeared in view (not a first mount): they rise up
  // from below instead of using the standard mount animation.
  const prevVisibleIdsRef = useRef<string[]>([])
  const displayedIds = displayedCards.map((c) => c.id)
  const freshIds = new Set(
    prevVisibleIdsRef.current.length === 0
      ? []
      : displayedIds.filter((id) => !prevVisibleIdsRef.current.includes(id))
  )
  useEffect(() => {
    prevVisibleIdsRef.current = displayedIds
  })

  const handleVanished = useCallback(
    (id: string) => {
      setVanishedIds((prev) => (prev.includes(id) ? prev : [...prev, id]))
      // Gone from the board = gone from the data.
      onCardGone?.(id)
    },
    [onCardGone]
  )

  // No manual moves into or out of Done — highlight only for To do / In progress.
  const showOver = dragOver && !isDone

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = "move"
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }
    setDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => {
    timeoutRef.current = setTimeout(() => setDragOver(false), 60)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault()
      setDragOver(false)
      // Done is locked: no manual drops into it (and its cards can't be
      // dragged out — they're rendered with draggable={false}).
      if (column.id === "done") return
      // Prefer React state, fall back to the native payload (some webviews
      // deliver the drop without the state update having flushed).
      const cardId =
        dragState?.cardId || e.dataTransfer.getData("text/plain")
      const from =
        dragState?.fromColumn ||
        (e.dataTransfer.getData("application/x-from-column") as ColumnStatus)
      if (!cardId || !from) return
      if (from === "done") return
      onDrop(cardId, from, column.id)
    },
    [dragState, onDrop, column.id]
  )

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      {/* Header — no entrance animation (tab-level intro covers it) */}
      <div className="mb-[14px] flex items-center gap-[7px] px-[2px]">
        {meta.icon}
        <span
          className="font-bold text-[13px] tracking-[-0.01em]"
          style={{ color: "var(--foreground)" }}
        >
          {column.title}
        </span>
        <motion.span
          animate={{ scale: 1, opacity: 1 }}
          className="ml-auto font-semibold text-[12.5px] tabular-nums"
          initial={{ scale: 0.6, opacity: 0 }}
          key={visibleCards.length}
          style={{ color: "var(--muted-foreground)" }}
          transition={springTransition}
        >
          {visibleCards.length}
        </motion.span>
      </div>

      {/* Card list — flex-1 so drop target spans full column below header (short / empty columns) */}
      <motion.div
        animate={{
          backgroundColor: showOver
            ? "rgba(59,130,246,0.045)"
            : "rgba(0,0,0,0)",
          scale: showOver ? 1.012 : 1,
        }}
        className="flex min-h-0 flex-1 flex-col gap-2 rounded-2xl p-0.5"
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        transition={{ type: "spring", stiffness: 400, damping: 24 }}
      >
        <DropIndicator isActive={showOver} />

        <AnimatePresence initial={false} mode="popLayout">
          {displayedCards.map((card, i) => (
            <Card
              card={card}
              enterFromBelow={freshIds.has(card.id)}
              index={i}
              isDone={isDone}
              isDragging={dragState?.cardId === card.id}
              key={card.id}
              locked={isDone}
              onDragEnd={() => setDragState(null)}
              onDragStart={(e) => {
                // Native payload first: guarantees the drop target can
                // identify the card even if React state hasn't flushed.
                e.dataTransfer.setData("text/plain", card.id)
                e.dataTransfer.setData(
                  "application/x-from-column",
                  column.id
                )
                e.dataTransfer.effectAllowed = "move"
                setDragState({ cardId: card.id, fromColumn: column.id })
              }}
              spinning={column.status === "in-progress"}
            />
          ))}
        </AnimatePresence>

        {isTodo && queuedCount > 0 && !holdingBack && (
          <div
            className="px-1 pb-0.5 pt-1 text-center text-[11px] font-medium"
            style={{ color: "var(--muted-foreground)" }}
          >
            +{queuedCount} more
          </div>
        )}

        {overflowCards.map((card) => (
          <Card
            card={card}
            index={0}
            isDone
            isDragging={false}
            key={card.id}
            locked
            onDragEnd={() => {}}
            onDragStart={() => {}}
            onVanished={handleVanished}
            vanish
          />
        ))}
      </motion.div>
    </div>
  )
}
