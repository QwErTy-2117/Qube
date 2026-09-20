"use client";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import {
  MarkdownText,
} from "@/components/assistant-ui/markdown-text";
import { DotMatrix } from "@/components/assistant-ui/dot-matrix";
import { MessageTiming } from "@/components/assistant-ui/message-timing";
import { ToolFallback } from "@/components/assistant-ui/tool-fallback";
import { Sources } from "@/components/assistant-ui/sources";
import {
  ToolGroupContent,
  ToolGroupRoot,
  ToolGroupTrigger,
} from "@/components/assistant-ui/tool-group";

import { usePermissionPoller, PermissionBar } from "@/components/assistant-ui/permission-prompt";
import { QuestionPanel } from "@/components/assistant-ui/question-panel";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  Reasoning,
  ReasoningContent,
  ReasoningRoot,
  ReasoningText,
  ReasoningTrigger,
} from "@/components/assistant-ui/reasoning";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import logoPng from "@/public/logo.png";
import { ChangedFiles } from "@/components/assistant-ui/tools/changed-files";
import { ConnectorsStrip } from "@/components/shared/connectors-strip";
import { PresentedFiles } from "@/components/assistant-ui/tools/presented-files";
import { SubagentToolUI } from "@/components/assistant-ui/tools/subagent-tool-ui";
import { GoalsPanel } from "@/components/assistant-ui/goals-panel";
import {
  ComposerQuotePreview,
  QuoteBlock,
  SelectionToolbar,
} from "@/components/assistant-ui/quote";
import { ComposerTriggerPopover } from "@/components/assistant-ui/composer-trigger-popover";
import { DirectiveText } from "@/components/assistant-ui/directive-text";
import {
  ActionBarMorePrimitive,
  ActionBarPrimitive,
  AuiIf,
  type AssistantState,
  ComposerPrimitive,
  ErrorPrimitive,
  groupPartByType,
  MessagePrimitive,
  ThreadListPrimitive,
  ThreadPrimitive,
  unstable_useMentionAdapter,
  unstable_useSlashCommandAdapter,
  useAui,
  useAuiState,
  type ToolCallMessagePart,
} from "@assistant-ui/react";
import {
  ArrowUpIcon,
  ChartColumnIcon,
  CheckIcon,
  CloudSunIcon,
  CodeXmlIcon,
  CopyIcon,
  DownloadIcon,
  MicIcon,
  MoreHorizontalIcon,
  PaperclipIcon,
  PencilIcon,
  PencilLineIcon,
  PlusIcon,
  RefreshCwIcon,
  Settings as SettingsIcon,
  SlashIcon,
  SquareIcon,
  WrenchIcon,
} from "lucide-react";
import {
  LexicalComposerInput,
  type DirectiveChipProps,
} from "@assistant-ui/react-lexical";
import { motion, AnimatePresence } from "motion/react";
import TextRotate from "@/components/fancy/text/text-rotate";
import Image from "next/image";
import { useState, useEffect, useCallback, useRef, type FC, type ReactNode } from "react";
import {
  ModelSelector,
  ModelSelectorModelContext,
  useModelSelectorEfforts,
  useModelSelectorContext,
} from "@/components/assistant-ui/model-selector";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { SettingsDialog, ProviderConfig, renderLobeIcon, detectModelIcon } from "@/components/shared/settings-dialog";
import { useTheme } from "next-themes";
import { OnboardingModal } from "@/components/shared/onboarding-dialog";
import { ConnectorConnectDialog } from "@/components/shared/connector-connect-dialog";
import { ChatErrorTopPopup, pushChatError, parseChatGPTError } from "@/components/chat/chat-error-popup";
import { DocumentPopup } from "@/components/workspace";
import { BrowserPanel } from "@/components/workspace";
import { openBrowserWorkspace, useWorkspaceStore } from "@/lib/workspace/store";

const baseToolGroupBy = groupPartByType({
  reasoning: ["group-tool", "group-chainOfThought"],
  "tool-call": ["group-tool", "group-chainOfThought"],
  "standalone-tool-call": [],
});

const messageGroupBy = (part: any, context: any) => {
  if (part.type === "tool-call" && part.toolName === "subagent") return [];
  if (part.type === "tool-call" && part.toolName === "TodoWrite") return [];
  // present_file renders nothing inline (its slim pill lives in the
  // PresentedFiles list at the bottom) — keep it out of tool groups so it
  // never affects group counts. write_file/edit_file stay grouped
  // (collapsed): they only render compact status rows, never cards, so
  // builder scripts stay hidden in the transcript instead of splashing
  // on top of the reply.
  if (part.type === "tool-call" && part.toolName === "present_file") return [];
  return baseToolGroupBy(part as any, context as any);
};

// Keep in sync with lib/connectors/composio.ts
const DESTRUCTIVE_KEYWORDS = [
  "send", "create", "post", "delete", "remove",
  "update", "edit", "modify", "upload", "transfer",
];

import { QubeSidebar } from "@/components/chat/qube-sidebar";
import { ChatSearchDialog } from "@/components/chat/chat-search-dialog";
import { ChatTitle } from "@/components/chat/chat-title";
import { ThreadUrlSync, WorkspaceThreadReset } from "@/components/chat/chat-route";

// Sidebar lives in components/chat/qube-sidebar.tsx (expandable w/ curtain
// reveal, thread list, search). Kept here only as a thin alias.
const Sidebar: FC = () => <QubeSidebar />;


import type { ModelOption } from "@/components/assistant-ui/model-selector";

const ModelPicker: FC = () => {
  const hasMessages = useAuiState((s) => s.thread.messages.length > 0);
  const [model, setModel] = useState("");
  const [models, setModels] = useState<ModelOption[]>([]);

  useEffect(() => {
    const syncModels = () => {
      const stored = localStorage.getItem("qube-providers");
      if (stored) {
        try {
          const providers: ProviderConfig[] = JSON.parse(stored);
          const toggledModels: ModelOption[] = [];
          providers.forEach((prov) => {
            if (prov.enabled) {
              prov.models.forEach((m) => {
                if (m.enabled) {
                  const iconName = m.icon || detectModelIcon(m.id, prov.id);
                  toggledModels.push({
                    id: m.id,
                    name: m.name,
                    icon: renderLobeIcon(iconName, 16),
                    reasoning: { supported: m.reasoning === true },
                    efforts: m.reasoning === true ? true : undefined,
                  });
                }
              });
            }
          });
          if (toggledModels.length > 0) {
            setModels(toggledModels);
            return;
          }
        } catch (e) {
          console.error("Failed to parse providers", e);
        }
      }
      setModels([]);
    };

    const syncModelsOrFetch = () => {
      const stored = localStorage.getItem("qube-providers");
      if (stored) {
        syncModels();
      } else {
        fetch("/api/providers/sync")
          .then((r) => r.json())
          .then((data) => {
            if (data.providers && data.providers.length > 0) {
              localStorage.setItem("qube-providers", JSON.stringify(data.providers));
              if (data.defaultModelId) localStorage.setItem("qube-default-model", data.defaultModelId);
              syncModels();
            }
          })
          .catch(() => {});
      }
    };

    syncModelsOrFetch();
    window.addEventListener("storage", syncModels);
    window.addEventListener("qube-providers-changed", syncModels);
    return () => {
      window.removeEventListener("storage", syncModels);
      window.removeEventListener("qube-providers-changed", syncModels);
    };
  }, []);

  useEffect(() => {
    const saved = localStorage.getItem("qube-default-model") || "";
    setModel(saved);
  }, []);

  useEffect(() => {
    if (models.length > 0) {
      const isCurrentValid = models.some((m) => m.id === model);
      if (!isCurrentValid) {
        setModel(models[0].id);
        localStorage.setItem("qube-default-model", models[0].id);
      }
    }
  }, [models, model]);

  const handleValueChange = (val: string) => {
    setModel(val);
    localStorage.setItem("qube-default-model", val);
  };

  const selectedModel = models.find((m) => m.id === model);

  return (
    <ModelSelector.Root
      models={models}
      value={model}
      onValueChange={handleValueChange}
    >
      <ModelSelectorModelContext />
      <motion.div
        layout
        transition={{ type: "spring", stiffness: 500, damping: 30 }}
        className="flex items-center"
      >
        <ModelSelector.Trigger
          variant="ghost"
          className="h-7 rounded-full text-sm shrink-0 justify-between px-2.5 py-1 w-auto min-w-0"
          arrowInverted={hasMessages}
        >
          <SingleModelText />
        </ModelSelector.Trigger>
      </motion.div>
      <ModelSelector.Content className="w-auto min-w-[220px] max-w-[320px] overflow-hidden rounded-xl p-0 shadow-lg">
        <ModelSelector.List />
        <ModelSelector.Effort />
      </ModelSelector.Content>
    </ModelSelector.Root>
  );
};

const SingleModelText: FC = () => {
  const { selectedModel } = useModelSelectorContext();
  const { efforts, effort } = useModelSelectorEfforts();
  const modelName = selectedModel?.name || (selectedModel as any)?.id?.split(":").pop() || "Select model";
  const thinkingName = efforts?.find((e) => e.id === effort)?.name;
  const hasThinking = !!effort && effort !== "off" && !!thinkingName;

  return (
    <span className="flex min-w-0 items-center gap-1.5 flex-1">
      {selectedModel?.icon && <span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">{selectedModel.icon}</span>}
      <span className="truncate font-medium">{modelName}</span>
      {hasThinking && <span className="text-sm font-light text-muted-foreground shrink-0">{thinkingName}</span>}
    </span>
  );
};

const ThinkingLevelInline: FC = () => {
  const { efforts, effort } = useModelSelectorEfforts();
  const activeName = efforts?.find((e) => e.id === effort)?.name;
  const isActive = !!effort && effort !== "off" && !!activeName;
  return (
    <motion.span
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className="text-sm font-light text-muted-foreground ml-1 shrink-0"
    >
      {activeName}
    </motion.span>
  );
};

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

const Thread: FC = () => {
  const isNew = useAuiState(isNewChatView);
  const mainId = useAuiState((s) => (s.threads as any)?.mainThreadId as string | undefined);
  // The handoff choreography (composer gliding center → bottom, welcome
  // fading, apps strip sliding under the bar) plays ONLY when the user sends
  // the first message from the landing composer: same thread, landing →
  // chat. Navigating to another chat (new or existing) switches instantly.
  const prevRef = useRef<{ isNew: boolean; id: string | undefined } | undefined>(undefined);
  const prev = prevRef.current;
  const sendHandoff = !!prev && prev.isNew && !isNew && prev.id === mainId;
  useEffect(() => {
    prevRef.current = { isNew, id: mainId };
  });
  const glideId = sendHandoff ? "qube-composer" : undefined;
  // Animated handoff exits (send only); navigation switches cut instantly.
  // Sequence: apps strip slides under the bar and vanishes first, the bar
  // glides down only once the strip is gone, messages fade in on landing.
  const welcomeExit = sendHandoff
    ? { opacity: 0, y: -20, transition: { duration: 0.25, ease: "easeIn" as const } }
    : { opacity: 0, transition: { duration: 0 } };
  const stripExit = sendHandoff
    ? { opacity: 0, y: 72, transition: { duration: 0.3, ease: "easeIn" as const } }
    : { opacity: 0, transition: { duration: 0 } };
  const glideTransition = sendHandoff
    ? { type: "spring" as const, stiffness: 260, damping: 30, delay: 0.26 }
    : { type: "spring" as const, stiffness: 260, damping: 30 };
  return (
    <ThreadPrimitive.Root
      className="aui-root aui-thread-root bg-background @container flex h-full flex-col"
      style={{
        ["--thread-max-width" as string]: "44rem",
        ["--composer-bg" as string]:
          "color-mix(in oklab, var(--color-muted) 30%, var(--color-background))",
        ["--composer-radius" as string]: "1.5rem",
        ["--composer-padding" as string]: "8px",
      }}
    >
      <ThreadPrimitive.Viewport
        turnAnchor="top"
        data-slot="aui_thread-viewport"
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden scroll-smooth px-4 pt-4"
      >
        {/* Landing ↔ chat handoff: popLayout pulls the exiting branch out of
            layout so the incoming layout is final instantly. On send (same
            thread gaining its first message) the composer glides center →
            bottom via the shared layoutId while the welcome fades up, the
            apps strip slides down under the bar, and the messages fade in.
            Navigation switches render statically (no layoutId, instant). */}
        <AnimatePresence initial={false} mode="popLayout">
          {isNew ? (
            <motion.div
              key="landing"
              className="flex flex-1 flex-col items-center justify-center gap-6 px-4"
            >
              <motion.div exit={welcomeExit}>
                <ThreadWelcome />
              </motion.div>
              <div className="flex w-full max-w-(--thread-max-width) flex-col">
                <motion.div
                  layoutId={glideId}
                  transition={glideTransition}
                  className="relative z-10 w-full"
                >
                  <Composer />
                </motion.div>
                <motion.div exit={stripExit}>
                  <ConnectorsStrip />
                </motion.div>
              </div>
            </motion.div>
          ) : (
            // NOTE: no opacity animation on this wrapper — the shared-element
            // composer glide must stay visible while it travels. Only the
            // messages fade in (after the bar lands).
            <motion.div
              key="chat"
              className="flex flex-1 flex-col"
            >
              <motion.div
                data-slot="aui_message-group"
                initial={sendHandoff ? { opacity: 0, y: 8 } : false}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: sendHandoff ? 0.32 : 0 }}
                className="mb-14 flex flex-col gap-y-6 empty:hidden"
              >
                <ThreadPrimitive.Messages>
                  {({ message }) => {
                    if (message.composer.isEditing) return <EditComposer />;
                    if (message.role === "user") return <UserMessage />;
                    return <AssistantMessage />;
                  }}
                </ThreadPrimitive.Messages>
              </motion.div>
              <ThreadPrimitive.ViewportFooter
                className="aui-thread-viewport-footer mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-2 overflow-visible sticky bottom-0 mt-auto pb-4 md:pb-6 bg-transparent"
              >
                <ThreadScrollToBottom />
                <GoalsPanel />
                <QuestionPanel />
                <motion.div
                  layoutId={glideId}
                  transition={glideTransition}
                >
                  <Composer />
                </motion.div>
              </ThreadPrimitive.ViewportFooter>
            </motion.div>
          )}
        </AnimatePresence>
      </ThreadPrimitive.Viewport>

      <SelectionToolbar />
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <button
        aria-label="Scroll to bottom"
        title="Scroll to bottom"
        className={
          isRunning
            ? "absolute -top-12 z-10 flex h-9 w-auto min-w-9 cursor-pointer items-center justify-center self-center rounded-full border border-border bg-popover/85 px-3 text-foreground shadow-lg backdrop-blur-xl transition hover:bg-popover disabled:invisible"
            : "absolute -top-12 z-10 flex size-9 cursor-pointer items-center justify-center self-center rounded-full border border-border bg-popover/85 text-foreground shadow-lg backdrop-blur-xl transition hover:bg-popover disabled:invisible"
        }
      >
        {isRunning ? (
          <span className="typing-dots" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
        ) : (
          <ArrowUpIcon className="size-4 rotate-180 text-muted-foreground/70" />
        )}
      </button>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const WELCOMES = [
  "Ready to build something?",
  "What are we making today?",
  "Let's write some code.",
  "What's on your mind?",
  "Hit me with it.",
  "What should we break today?",
  "Another day, another feature.",
  "Ready when you are.",
  "What's the plan?",
  "What are we shipping?",
  "Let's make it work.",
  "What's the task?",
  "Go ahead, I'm listening.",
  "What's cooking?",
  "Let's get to it.",
  "Spill the requirements.",
  "What's the damage?",
  "Fire away.",
  "What will it be?",
  "I'm all ears.",
];

const ThreadWelcome: FC = () => {
  const [welcome] = useState(() => WELCOMES[Math.floor(Math.random() * WELCOMES.length)]);

  return (
    <div className="aui-thread-welcome-root mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
      <h1
        suppressHydrationWarning
        className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200"
      >
        {welcome}
      </h1>
    </div>
  );
};

const slashIconMap: Record<string, FC<{ className?: string }>> = {
  Attach: PaperclipIcon,
  None: () => null,
};

type SlashSkill = { name: string; description: string };

function loadSlashSkills(): SlashSkill[] {
  if (typeof window === "undefined") return [];
  try {
    const raw =
      localStorage.getItem("qube-skills") ||
      localStorage.getItem("qube-skills-cache");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s: any) => s && typeof s.name === "string" && s.userInvocable !== false)
      .map((s: any) => ({
        name: String(s.name),
        description: typeof s.description === "string" ? s.description : "",
      }));
  } catch {
    return [];
  }
}

function DirectiveChip(props: DirectiveChipProps) {
  const { directiveId, directiveType, label } = props;
  const showWrench = directiveType !== "command";
  return (
    <span
      className="aui-directive-chip"
      data-directive-type={directiveType}
      data-directive-id={directiveId}
    >
      {showWrench && (
        <span className="aui-directive-chip-icon">
          <WrenchIcon className="size-3" />
        </span>
      )}
      <span className="aui-directive-chip-label">{label}</span>
    </span>
  );
}

const PermissionBlocker: FC<{
  permissionPending: any;
  onRespondPermission: (approved: boolean, always?: boolean) => void;
}> = ({ permissionPending, onRespondPermission }) => {
  if (permissionPending) {
    return (
      <div data-slot="aui-permission-blocker" className="mb-2 w-full">
        <PermissionBar pending={permissionPending} onRespond={onRespondPermission} />
      </div>
    );
  }

  return null;
};

// Pasted text at or above this length becomes a .txt attachment
// instead of being dumped raw into the composer input.
const PASTE_AS_FILE_THRESHOLD = 2000;

const PLACEHOLDERS = [
  "Draft an email or summarize notes...",
  "Plan a trip or organize your schedule...",
  "Generate a presentation slide deck...",
  "Create a budget spreadsheet with categories...",
  "Connect your calendar or team apps...",
  "Ask Qube to help with any task...",
];

const Composer: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const [showAnimated, setShowAnimated] = useState(true);
  const aui = useAui();
  // Scoped to this instance's shell: document.querySelector would grab the
  // first shell in the document, which during branch transitions is the
  // stale exiting copy — freezing the suggestions overlay visible while
  // typing in the new composer.
  const shellRef = useRef<HTMLDivElement | null>(null);

  // Large pastes become .txt attachments instead of flooding the input.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target?.closest?.("[data-slot='aui_composer-shell']")) return;
      const dt = e.clipboardData;
      if (!dt) return;
      // Real file pastes (images, etc.) take the default path.
      if (dt.files && dt.files.length > 0) return;
      const text = dt.getData("text/plain");
      if (!text || text.length < PASTE_AS_FILE_THRESHOLD) return;
      e.preventDefault();
      e.stopPropagation();
      const file = new File([text], `paste-${Date.now().toString(36)}.txt`, {
        type: "text/plain",
      });
      aui.composer().addAttachment(file).catch((err) => {
        console.error("[composer] failed to attach pasted text", err);
      });
    };
    document.addEventListener("paste", onPaste, true);
    return () => document.removeEventListener("paste", onPaste, true);
  }, [aui]);

  useEffect(() => {
    const shell = shellRef.current;
    if (!shell) return;

    const check = () => {
      const lp = shell.querySelector<HTMLElement>(".aui-lexical-placeholder");
      setShowAnimated(
        !!lp &&
          lp.style.display !== "none" &&
          window.getComputedStyle(lp).display !== "none"
      );
    };

    const observer = new MutationObserver(check);
    observer.observe(shell, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
    check();

    return () => observer.disconnect();
  }, []);

  const mention = unstable_useMentionAdapter({ fallbackIcon: WrenchIcon });

  // Installed skills (system + custom + marketplace) as / commands.
  // Selecting one inserts `:skill[name]` directive syntax (not plain text) so
  // the SyncPlugin renders it as a badge chip in the composer and
  // DirectiveText renders it as a badge in the sent message.
  // The Pi harness auto-applies the skill from its description.
  const [slashSkills, setSlashSkills] = useState<SlashSkill[]>(() => loadSlashSkills());
  useEffect(() => {
    let cancelled = false;
    fetch("/api/skills/sync")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data || !Array.isArray(data.skills)) return;
        const list = data.skills
          .filter((s: any) => s && typeof s.name === "string" && s.userInvocable !== false)
          .map((s: any) => ({
            name: String(s.name),
            description: typeof s.description === "string" ? s.description : "",
          }));
        setSlashSkills(list);
        try {
          localStorage.setItem("qube-skills-cache", JSON.stringify(data.skills));
        } catch {}
      })
      .catch(() => {});
    const onChange = () => setSlashSkills(loadSlashSkills());
    window.addEventListener("qube-skills-changed", onChange);
    return () => {
      cancelled = true;
      window.removeEventListener("qube-skills-changed", onChange);
    };
  }, []);

  const insertSkillCommand = useCallback(
    (name: string) => {
      try {
        // Directive syntax (:skill[name]{name=name}) — renders as a badge
        // chip in the composer (SyncPlugin → DirectiveNode → DirectiveChip)
        // and as a Badge in the sent message (DirectiveText). The skill name
        // stays in the text so the harness still matches it.
        const safe = String(name).replace(/[\[\]{}:]/g, "");
        aui.composer().setText(`:skill[${safe}]{name=${safe}} `);
      } catch (e) {
        console.error("[slash] failed to insert skill command", e);
      }
    },
    [aui],
  );

  const attachFiles = useCallback(() => {
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.multiple = true;
      input.accept = "image/*,.pdf,.docx,.xlsx,.csv,.zip,.pptx,.txt,.md";
      input.hidden = true;
      document.body.appendChild(input);
      input.onchange = () => {
        const files = input.files;
        if (files) {
          for (const file of files) {
            aui.composer().addAttachment(file).catch(console.error);
          }
        }
        document.body.removeChild(input);
      };
      input.oncancel = () => {
        if (!input.files || input.files.length === 0) {
          try { document.body.removeChild(input); } catch {}
        }
      };
      input.click();
    } catch (e) {
      console.error("[slash] failed to open file picker", e);
    }
  }, [aui]);

  const slash = unstable_useSlashCommandAdapter({
    commands: [
      {
        id: "add-files",
        label: "Add files",
        description: "Attach files from your computer to this message",
        icon: "Attach",
        execute: () => attachFiles(),
      },
      ...slashSkills.map((s) => ({
        id: s.name,
        label: s.name,
        description: s.description || "Skill",
        icon: "None",
        execute: () => insertSkillCommand(s.name),
      })),
    ],
    iconMap: slashIconMap,
    fallbackIcon: SlashIcon,
    removeOnExecute: true,
  });

  const { pending: permissionPending, respond: respondPermission } =
    usePermissionPoller();

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <PermissionBlocker
          permissionPending={permissionPending}
          onRespondPermission={respondPermission}
        />
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            ref={shellRef}
            data-slot="aui_composer-shell"
            className={cn(
              "flex w-full flex-col gap-2 rounded-(--composer-radius) p-(--composer-padding) transition-[border-color,box-shadow] data-[dragging=true]:border-dashed",
              "rainbow-border bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] dark:shadow-none",
              isRunning && "rainbow-border-active",
              "data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))]",
            )}
          >
            <motion.div layout transition={{ duration: 0.15 }}>
              <ComposerQuotePreview />
              <ComposerAttachments />
              <div className="relative">
                <LexicalComposerInput
                  directiveChip={DirectiveChip}
                  autoFocus
                  placeholder={PLACEHOLDERS[0]}
                  className="aui-composer-input [&_.aui-lexical-placeholder]:text-muted-foreground/50 [&_.aui-lexical-placeholder]:opacity-0 relative max-h-32 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base outline-none [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-muted [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:leading-none [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-foreground [&_.aui-directive-chip-icon]:self-center [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none [&_.aui-lexical-placeholder]:pointer-events-none [&_.aui-lexical-placeholder]:absolute [&_.aui-lexical-placeholder]:top-0 [&_.aui-lexical-placeholder]:right-0 [&_.aui-lexical-placeholder]:left-0 [&_.aui-lexical-placeholder]:truncate [&_.aui-lexical-placeholder]:px-2.5 [&_.aui-lexical-placeholder]:py-1"
                />
                {showAnimated && (
                  <div className="absolute inset-x-2.5 top-1 overflow-hidden pointer-events-none">
                    <TextRotate
                      texts={PLACEHOLDERS}
                      mainClassName="flex text-base text-muted-foreground/50"
                      rotationInterval={4000}
                      staggerFrom="last"
                      initial={{ y: "100%" }}
                      animate={{ y: 0 }}
                      exit={{ y: "-120%" }}
                      staggerDuration={0.025}
                      transition={{
                        type: "spring",
                        damping: 30,
                        stiffness: 400,
                      }}
                      splitBy="characters"
                      splitLevelClassName="overflow-hidden"
                    />
                  </div>
                )}
              </div>
            </motion.div>
            <motion.div layout transition={{ duration: 0.15 }}>
              <ComposerAction />
            </motion.div>
          </div>
        </ComposerPrimitive.AttachmentDropzone>

        <ComposerTriggerPopover char="@" {...mention} />

        <ComposerTriggerPopover
          char="/"
          {...slash}
          className="w-max min-w-56 max-w-80 rounded-2xl p-1.5"
          listClassName="flex max-h-64 flex-col gap-0.5 overflow-y-auto scrollbar-none [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden"
          itemClassName="hover:bg-accent focus:bg-accent data-[highlighted]:bg-accent relative flex w-full cursor-pointer flex-col items-start gap-0.5 rounded-lg px-3 py-2 text-start whitespace-nowrap transition-colors outline-none"
          emptyItemsLabel="No matching skills"
          hideItemDescriptions
          showTooltips
          overflowVisible
        />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

const SendButton: FC = () => {
  return (
    <ComposerPrimitive.Send asChild>
      <TooltipIconButton
        tooltip="Send message"
        side="bottom"
        type="button"
        variant="default"
        size="icon"
        className="aui-composer-send flex !size-7 items-center justify-center !rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
        aria-label="Send message"
      >
        <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
      </TooltipIconButton>
    </ComposerPrimitive.Send>
  );
};

const ComposerAction: FC = () => {
  const isRunning = useAuiState((s) => s.thread.isRunning);
  const hasInput = useAuiState((s) => {
    const t = (s.composer as unknown as { text?: string })?.text ?? "";
    const atts = (s.composer as unknown as { attachments?: unknown[] })?.attachments?.length ?? 0;
    return String(t).trim().length > 0 || atts > 0;
  });
  return (
    <div className="aui-composer-action-wrapper relative flex items-center justify-between">
      <div className="flex items-center gap-1">
        <ComposerAddAttachment />
        <ModelPicker />
      </div>
      <div className="flex items-center gap-1.5">
        <AuiIf condition={(s) => s.thread.capabilities.dictation}>
          <AuiIf condition={(s) => s.composer.dictation == null}>
            <ComposerPrimitive.Dictate asChild>
              <TooltipIconButton
                tooltip="Voice input"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-dictate !size-7 rounded-full"
                aria-label="Start voice input"
              >
                <MicIcon className="aui-composer-dictate-icon size-4" />
              </TooltipIconButton>
            </ComposerPrimitive.Dictate>
          </AuiIf>
          <AuiIf condition={(s) => s.composer.dictation != null}>
            <ComposerPrimitive.StopDictation asChild>
              <TooltipIconButton
                tooltip="Stop dictation"
                side="bottom"
                type="button"
                variant="ghost"
                size="icon"
                className="aui-composer-stop-dictation text-destructive !size-7 rounded-full"
                aria-label="Stop voice input"
              >
                <SquareIcon className="aui-composer-stop-dictation-icon size-3.5 animate-pulse fill-current" />
              </TooltipIconButton>
            </ComposerPrimitive.StopDictation>
          </AuiIf>
        </AuiIf>
        {!isRunning ? (
          <SendButton />
        ) : hasInput ? (
          <SendButton />
        ) : (
          <ComposerPrimitive.Cancel asChild>
            <Button
              type="button"
              variant="default"
              size="icon"
              className="aui-composer-cancel !size-7 !rounded-full"
              aria-label="Stop generating"
            >
              <SquareIcon className="aui-composer-cancel-icon size-3.5 fill-current" />
            </Button>
          </ComposerPrimitive.Cancel>
        )}
      </div>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root border-destructive bg-destructive/10 text-destructive dark:bg-destructive/5 mt-2 rounded-md border p-3 text-sm dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const TOOL_GROUP_TITLES: Record<string, string> = {
  read_file: "Sneaking a peek",
  write_file: "Doodling something up",
  edit_file: "Tweaking things",
  delete_file: "Sending to the void",
  list_directory: "Nosing around",
  run_command: "Making magic happen",
  web_search: "Going down a rabbit hole",
  web_fetch: "Grabbing a page",

  list_sessions: "Checking the logbook",
  read_session_summary: "Skimming the past",
  read_session: "Reading the tea leaves",
  read_memory: "Scratching the brain",
  ask_user: "Poking the human",
  ask_question: "Asking you",

  gmail: "Fiddling with your inbox",
  slack: "Slacking off",
  linear: "Organizing chaos",
  github: "Poking the repo",
  googlecalendar: "Rearranging your life",
  googledrive: "Digging through files",
  notion: "Notion-ing around",
  hubspot: "CRM-ing it up",
  asana: "Asana-ing tasks",
  trello: "Carding things",
  airtable: "Databasing casually",
  dropbox: "Dropping files",
  jira: "Ticketing around",
  composio: "Rooting around your apps",
};



function getToolLabel(part: ToolCallMessagePart): string {
  const label = (part.args as any)?.label;
  if (label) return label;
  const title = TOOL_GROUP_TITLES[part.toolName];
  if (title) return title;
  const lower = part.toolName.toLowerCase();
  for (const [prefix, title] of Object.entries(TOOL_GROUP_TITLES)) {
    if (lower.startsWith(prefix)) return title;
  }
  return part.toolName;
}

function ToolGroupWithTitle({
  indices,
  active,
  children,
}: {
  indices: readonly number[];
  active: boolean;
  children: ReactNode;
}) {
  const message = useAuiState((s) => s.message);
  const parts = indices
    .map((i) => message.content[i])
    .filter((p): p is ToolCallMessagePart => p?.type === "tool-call");
  const reasoningParts = indices
    .map((i) => message.content[i])
    .filter((p): p is { type: "reasoning"; text: string } => p?.type === "reasoning");
  const labels = parts.map(getToolLabel);
  const title = labels[labels.length - 1] || (reasoningParts.length > 0 ? "Thinking" : "Performing operations");
  return (
    <ToolGroupRoot variant="ghost">
      <ToolGroupTrigger
        count={indices.length}
        active={active}
        label={title}
      />
      <ToolGroupContent>{children}</ToolGroupContent>
    </ToolGroupRoot>
  );
}

const AssistantWorkingIndicator: FC = () => {
  const isEmpty = useAuiState((s) => s.message.content.length === 0);
  if (isEmpty) {
    return (
      <span
        data-slot="aui_assistant-message-indicator"
        className="text-muted-foreground inline-flex items-center gap-2 align-middle"
      >
        <DotMatrix state="connecting" aria-hidden />
        <span className="text-sm">Connecting</span>
      </span>
    );
  }
  return (
    <span
      data-slot="aui_assistant-message-indicator"
      className="animate-pulse font-sans"
      aria-label="Assistant is working"
    >
      {"●"}
    </span>
  );
};

const AssistantMessage: FC = () => {
  // reserves space for action bar and compensates with `-mb` for consistent msg spacing
  // keeps hovered action bar from shifting layout (autohide doesn't support absolute positioning well)
  // for pt-[n] use -mb-[n + 6] & min-h-[n + 6] to preserve compensation
  const ACTION_BAR_PT = "pt-1.5";
  const ACTION_BAR_HEIGHT = `-mb-7.5 min-h-7.5 ${ACTION_BAR_PT}`;

  return (
    <MessagePrimitive.Root
      data-slot="aui_assistant-message-root"
      data-role="assistant"
      className="fade-in slide-in-from-bottom-1 animate-in relative mx-auto w-full max-w-(--thread-max-width) duration-150"
    >
      <div
        data-slot="aui_assistant-message-content"
        className="text-foreground px-2 leading-relaxed wrap-break-word"
      >
        <MessagePrimitive.GroupedParts groupBy={messageGroupBy as any}>
          {({ part, children }) => {
            switch (part.type) {
              case "group-chainOfThought":
                return <div data-slot="aui_chain-of-thought">{children}</div>;
              case "group-tool":
                if (part.indices.length === 1) {
                  return children;
                }
                return (
                  <ToolGroupWithTitle
                    indices={part.indices}
                    active={part.status.type === "running"}
                  >
                    {children}
                  </ToolGroupWithTitle>
                );
              case "group-reasoning": {
                const running = part.status.type === "running";
                return (
                  <ReasoningRoot streaming={running}>
                    <ReasoningTrigger active={running} />
                    <ReasoningContent aria-busy={running}>
                      <ReasoningText>{children}</ReasoningText>
                    </ReasoningContent>
                  </ReasoningRoot>
                );
              }
              case "text": {
                // [file: path] markers and literal present_file(path="...")
                // render inline as cards via remarkFileRefs (exact position).
                return <MarkdownText />;
              }
              case "reasoning": {
                // Render reasoning as a tool-group-like compressed component
                const running = part.status?.type === "running";
                return (
                  <ToolGroupRoot variant="ghost" defaultOpen={running}>
                    <ToolGroupTrigger
                      count={1}
                      active={running}
                      label="Thinking"
                    />
                    <ToolGroupContent>
                      <ReasoningContent aria-busy={running}>
                        <ReasoningText>{part.text}</ReasoningText>
                      </ReasoningContent>
                    </ToolGroupContent>
                  </ToolGroupRoot>
                );
              }
              case "tool-call":
                if (part.toolName === "subagent") {
                  return (
                    <SubagentToolUI
                      toolCallId={part.toolCallId}
                      args={part.args as any}
                      result={part.result as any}
                      isExecuting={part.status.type === "running"}
                    />
                  );
                }
                // TodoWrite renders in the docked GoalsPanel above the composer, not inline.
                if (part.toolName === "TodoWrite") {
                  return null;
                }
                // present_file renders nothing inline — its slim pill lives
                // in the PresentedFiles list pinned to the bottom of the
                // message, so cards never stack on top of the reply.
                if (part.toolName === "present_file") {
                  return null;
                }
                const isDestructive = DESTRUCTIVE_KEYWORDS.some(kw =>
                  part.toolName.toLowerCase().includes(kw)
                );
                return (
                  <ToolGroupRoot variant="ghost" defaultOpen={isDestructive}>
                    <ToolGroupTrigger
                      count={1}
                      active={part.status.type === "running"}
                      label={getToolLabel(part)}
                    />
                    <ToolGroupContent>
                      {part.toolUI ?? <ToolFallback {...part} />}
                    </ToolGroupContent>
                  </ToolGroupRoot>
                );
              case "source":
                return <Sources {...(part as any)} />;
              case "indicator":
                return <AssistantWorkingIndicator />;
              case "data":
                return part.dataRendererUI;
              default:
                return null;
            }
          }}
        </MessagePrimitive.GroupedParts>
        <PresentedFiles />
        <ChangedFiles />
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ml-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
};

const handleExportMarkdown = async (content: string) => {
  const date = new Date();
  const stamp = `${date.toISOString().slice(0, 10)}_${date.getHours().toString().padStart(2, "0")}-${date.getMinutes().toString().padStart(2, "0")}`;
  const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `qube-message-${stamp}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-assistant-action-bar-root text-muted-foreground animate-in fade-in col-start-3 row-start-2 -ml-1 flex gap-1 duration-200"
    >
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy" className="!size-6">
          <AuiIf condition={(s) => s.message.isCopied}>
            <CheckIcon className="size-3.5 animate-in zoom-in-50 fade-in duration-200 ease-out" />
          </AuiIf>
          <AuiIf condition={(s) => !s.message.isCopied}>
            <CopyIcon className="size-3.5 animate-in zoom-in-75 fade-in duration-150" />
          </AuiIf>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Refresh" className="!size-6">
          <RefreshCwIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
      <ActionBarMorePrimitive.Root>
        <ActionBarMorePrimitive.Trigger asChild>
          <TooltipIconButton
            tooltip="More"
            className="!size-6 data-[state=open]:bg-accent"
          >
            <MoreHorizontalIcon className="size-3.5" />
          </TooltipIconButton>
        </ActionBarMorePrimitive.Trigger>
        <ActionBarMorePrimitive.Content
          side="bottom"
          align="start"
          sideOffset={6}
          className="aui-action-bar-more-content bg-popover text-popover-foreground data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:animate-out data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 min-w-[8rem] overflow-hidden rounded-xl border p-1 shadow-lg"
        >
          <ActionBarPrimitive.ExportMarkdown asChild onExport={handleExportMarkdown}>
            <ActionBarMorePrimitive.Item className="aui-action-bar-more-item hover:bg-accent hover:text-accent-foreground focus:bg-accent focus:text-accent-foreground flex cursor-pointer items-center gap-2 rounded-md px-2.5 py-2 text-sm outline-none select-none">
              <DownloadIcon className="size-4" />
              Export as Markdown
            </ActionBarMorePrimitive.Item>
          </ActionBarPrimitive.ExportMarkdown>
        </ActionBarMorePrimitive.Content>
      </ActionBarMorePrimitive.Root>
      <MessageTiming />
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_user-message-root"
      data-role="user"
      className="fade-in slide-in-from-bottom-1 animate-in mx-auto grid w-full max-w-(--thread-max-width) auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] content-start gap-y-2 px-2 duration-150 [&:where(>*)]:col-start-2"
    >
      <UserMessageAttachments />

      <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
        <div className="aui-user-message-content peer bg-muted text-foreground rounded-xl px-4 py-2 wrap-break-word empty:hidden">
          <MessagePrimitive.Quote>
            {(quote) => <QuoteBlock {...quote} />}
          </MessagePrimitive.Quote>
          <MessagePrimitive.Parts components={{ Text: DirectiveText }} />
        </div>
        <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2 peer-empty:hidden">
          <UserActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const UserActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      className="aui-user-action-bar-root flex flex-col items-end"
    >
      <ActionBarPrimitive.Edit asChild>
        <TooltipIconButton tooltip="Edit" className="!size-6">
          <PencilIcon className="size-3.5" />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <MessagePrimitive.Root
      data-slot="aui_edit-composer-wrapper"
      className="mx-auto flex w-full max-w-(--thread-max-width) flex-col px-2"
    >
      <ComposerPrimitive.Unstable_TriggerPopoverRoot>
        <ComposerPrimitive.Root className="aui-edit-composer-root border-border/60 dark:border-muted-foreground/15 ml-auto flex w-full max-w-[85%] flex-col rounded-(--composer-radius) border bg-(--composer-bg) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] dark:shadow-none">
          <LexicalComposerInput
            directiveChip={DirectiveChip}
            autoFocus
            className="aui-edit-composer-input text-foreground min-h-14 w-full resize-none bg-transparent px-4 pt-3 pb-1 text-base outline-none [&_.aui-directive-chip]:inline-flex [&_.aui-directive-chip]:items-baseline [&_.aui-directive-chip]:gap-1 [&_.aui-directive-chip]:rounded-md [&_.aui-directive-chip]:bg-muted [&_.aui-directive-chip]:px-1.5 [&_.aui-directive-chip]:py-0.5 [&_.aui-directive-chip]:text-[13px] [&_.aui-directive-chip]:leading-none [&_.aui-directive-chip]:font-medium [&_.aui-directive-chip]:text-foreground [&_.aui-directive-chip-icon]:self-center [&_.aui-lexical-input]:min-h-lh [&_.aui-lexical-input]:outline-none"
          />
          <div className="aui-edit-composer-footer mx-2.5 mb-2.5 flex items-center gap-1.5 self-end">
            <ComposerPrimitive.Cancel asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 rounded-full px-3.5"
              >
                Cancel
              </Button>
            </ComposerPrimitive.Cancel>
            <ComposerPrimitive.Send asChild>
              <Button size="sm" className="h-8 rounded-full px-3.5">
                Update
              </Button>
            </ComposerPrimitive.Send>
          </div>
        </ComposerPrimitive.Root>
      </ComposerPrimitive.Unstable_TriggerPopoverRoot>
    </MessagePrimitive.Root>
  );
};

const ChatErrorWatcher: FC = () => {
  const messages = useAuiState((s) => s.thread.messages);
  const lastSeenRef = useState(() => new Set<string>())[0] as Set<string>;
  useEffect(() => {
    for (const msg of messages) {
      const parts: any[] = (msg as any).content || (msg as any).parts || [];
      for (const part of parts) {
        if (part.type === "text" && typeof part.text === "string" && /usage_limit_reached|responses_request_failed/i.test(part.text)) {
          const key = `${msg.id}-${part.text.slice(0, 80)}`;
          if (!lastSeenRef.has(key)) {
            lastSeenRef.add(key);
            const parsed = parseChatGPTError(part.text);
            if (parsed) pushChatError(parsed);
            else pushChatError({ title: "Request failed", message: part.text.slice(0, 300), detail: part.text, status: 429 });
          }
        }
        // Also check for error parts
        if ((part as any).status?.type === "error" || (part as any).type === "error") {
          const errText = (part as any).errorText || (part as any).text || "";
          if (errText) {
            const key = `${msg.id}-${errText.slice(0, 80)}`;
            if (!lastSeenRef.has(key)) {
              lastSeenRef.add(key);
              const parsed = parseChatGPTError(errText);
              if (parsed) pushChatError(parsed);
            }
          }
        }
      }
    }
  }, [messages, lastSeenRef]);
  return null;
};

// Opens the browser side panel when the agent uses browser tools.
// Never closes it automatically — the window stays open after the run;
// only the panel X (or app shutdown) ends the session.
// Opens the browser side panel when the agent uses browser tools.
// Opens ONCE per tool call (tracked by toolCallId): closing the panel
// dismisses it until a NEW browser call arrives — it never reopens
// itself on re-renders, and nothing auto-closes the window.
const openedBrowserCallIds = new Set<string>();
const BrowserAutoOpener: FC = () => {
  const messages = useAuiState((s) => s.thread.messages);
  const mountedRef = useRef(false);
  useEffect(() => {
    try {
      const ids: string[] = [];
      for (const m of messages as unknown as Array<{
        content?: Array<{ type?: string; toolName?: string; toolCallId?: string }>;
        parts?: Array<{ type?: string; toolName?: string; toolCallId?: string }>;
      }>) {
        const parts = m?.content || m?.parts || [];
        for (const p of parts) {
          if (p?.type === "tool-call" && typeof p?.toolName === "string" && (p.toolName.startsWith("browser_") || ["open_tab","navigate","tabs","user_tabs","page_info","cdp","move_mouse","run_action_plan","wait_load","claim_tab","finalize_tabs","ping","info"].includes(p.toolName))) {
            ids.push(typeof p.toolCallId === "string" && p.toolCallId ? p.toolCallId : `${p.toolName}`);
          }
        }
      }
      // On (re)mount, follow an already browser-active thread: the panel
      // shows the shared live browser, so reopen to keep following it.
      if (!mountedRef.current) {
        mountedRef.current = true;
        ids.forEach((id) => openedBrowserCallIds.add(id));
        if (ids.length > 0) {
          const st = useWorkspaceStore.getState();
          if (!st.open || st.artifact?.kind !== "browser") openBrowserWorkspace();
          return;
        }
      }
      const fresh = ids.filter((id) => !openedBrowserCallIds.has(id));
      if (fresh.length > 0) {
        fresh.forEach((id) => openedBrowserCallIds.add(id));
        // Bound memory: forget calls from long-finished threads.
        if (openedBrowserCallIds.size > 200) {
          const arr = [...openedBrowserCallIds];
          arr.slice(0, arr.length - 200).forEach((id) => openedBrowserCallIds.delete(id));
        }
        const st = useWorkspaceStore.getState();
        if (!st.open || st.artifact?.kind !== "browser") openBrowserWorkspace();
      }
    } catch {}
  }, [messages]);
  return null;
};

// TEMPORARY live-test handle (removed before release).
const DebugSend: FC = () => {
  const aui = useAui();
  useEffect(() => {
    try {
      (window as any).__qubeSend = (text: string) =>
        aui.thread().append({ content: [{ type: "text", text }] } as any);
    } catch {}
  });
  return null;
};

export const Base: FC = () => {
  return (
    <div className="bg-muted relative flex h-full w-full pl-2">
      <ChatErrorTopPopup />
      <ChatErrorWatcher />
      <BrowserAutoOpener />
      <ThreadUrlSync />
      <WorkspaceThreadReset />
      <DebugSend />
      <ChatSearchDialog />
      <div data-tauri-no-drag-region>
        <Sidebar />
      </div>
      <div data-tauri-no-drag-region className="flex min-w-0 flex-1 flex-col overflow-hidden md:pl-0 relative">
        <div className="flex min-w-0 flex-1 gap-2 overflow-hidden p-2">
          <div className="bg-background flex min-w-0 flex-1 flex-col overflow-hidden rounded-2xl [&_main]:overflow-hidden relative"
          >
            <ChatTitle />
            <main className="min-h-0 flex-1">
              <Thread />
            </main>
          </div>
          <BrowserPanel />
        </div>
      </div>
      <DocumentPopup />
      <ConnectorConnectDialog />
    </div>
  );
};
