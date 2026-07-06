"use client";

import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/assistant-ui/attachment";
import {
  MarkdownText,
  MarkdownTextPrimitive,
  defaultComponents,
  remarkGfm,
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
import { useAskUserPoller, AskUserBar } from "@/components/assistant-ui/ask-user-prompt";
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
import { FileCard } from "@/components/assistant-ui/tools/file-card";
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
  BranchPickerPrimitive,
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
  type Unstable_SlashCommand,
} from "@assistant-ui/react";
import {
  ArrowDownToLineIcon,
  ArrowUpIcon,
  ChartColumnIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloudSunIcon,
  CodeXmlIcon,
  CopyIcon,
  DownloadIcon,
  FileTextIcon,
  GlobeIcon,
  HelpCircleIcon,
  LanguagesIcon,
  LightbulbIcon,
  MicIcon,
  MoreHorizontalIcon,
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
import { useState, useEffect, type FC, type ReactNode } from "react";
import { ModelSelector } from "@/components/assistant-ui/model-selector";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { docsModelOptions } from "@/components/docs/assistant/docs-model-options";
import { DEFAULT_MODEL_ID } from "@/constants/model";
import { SettingsDialog } from "@/components/shared/settings-dialog";

const Sidebar: FC = () => {
  return (
    <aside className="flex h-full w-12 flex-col overflow-hidden">
      <div className="mt-2 flex h-12 shrink-0 items-center px-3.5">
        <Image
          src={logoPng}
          alt="logo"
          className="size-5 shrink-0"
        />
      </div>
      <ThreadListPrimitive.New asChild>
        <TooltipIconButton
          tooltip="New thread"
          side="right"
          variant="ghost"
          size="icon"
          className="mt-1 ml-2 size-8 transition-all duration-200 hover:[transform:translateY(-3px)_rotate(-5deg)]"
        >
          <PlusIcon className="size-4" />
        </TooltipIconButton>
      </ThreadListPrimitive.New>
      <div className="mt-auto mb-2 flex flex-col items-center gap-1">
        <AnimatedThemeToggler
          variant="circle"
          className="flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground [&_svg]:size-4"
        />
        <SettingsDialog>
          <div>
            <TooltipIconButton
              tooltip="Settings"
              side="right"
              variant="ghost"
              size="icon"
              className="size-8 rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
            >
              <SettingsIcon className="size-4" />
            </TooltipIconButton>
          </div>
        </SettingsDialog>
      </div>
    </aside>
  );
};

const models = docsModelOptions();

const ModelPicker: FC = () => {
  const hasMessages = useAuiState((s) => s.thread.messages.length > 0);
  const [model, setModel] = useState(DEFAULT_MODEL_ID);

  useEffect(() => {
    const saved = localStorage.getItem("qube-default-model") || DEFAULT_MODEL_ID;
    setModel(saved);
  }, []);

  const handleValueChange = (val: string) => {
    setModel(val);
    localStorage.setItem("qube-default-model", val);
  };

  return (
    <ModelSelector
      models={models}
      value={model}
      onValueChange={handleValueChange}
      variant="ghost"
      className="h-7 rounded-full text-sm"
      arrowInverted={hasMessages}
    />
  );
};

// Startup exposes a loading placeholder thread; treat it as a new chat so
// the composer mounts centered. Loads after startup keep the docked layout.
const isNewChatView = (s: AssistantState) =>
  s.thread.messages.length === 0 &&
  (!s.thread.isLoading || s.threads.isLoading);

const Thread: FC = () => {
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
        className="relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
      >
        <AuiIf condition={isNewChatView}>
          <div className="flex flex-1 flex-col items-center justify-center gap-6 px-4">
            <ThreadWelcome />
            <div className="w-full max-w-(--thread-max-width)">
              <Composer />
            </div>
            <div className="w-full max-w-(--thread-max-width)">
              <ThreadSuggestions />
            </div>
          </div>
        </AuiIf>

        <AuiIf condition={(s) => !isNewChatView(s)}>
          <div
            data-slot="aui_message-group"
            className="mb-14 flex flex-col gap-y-6 empty:hidden"
          >
            <ThreadPrimitive.Messages>
              {({ message }) => {
                if (message.composer.isEditing) return <EditComposer />;
                if (message.role === "user") return <UserMessage />;
                return <AssistantMessage />;
              }}
            </ThreadPrimitive.Messages>
          </div>
          <ThreadPrimitive.ViewportFooter
            className="aui-thread-viewport-footer bg-background mx-auto flex w-full max-w-(--thread-max-width) flex-col gap-4 overflow-visible sticky bottom-0 mt-auto rounded-t-(--composer-radius) pb-4 md:pb-6"
          >
            <ThreadScrollToBottom />
            <Composer />
          </ThreadPrimitive.ViewportFooter>
        </AuiIf>
      </ThreadPrimitive.Viewport>

      <SelectionToolbar />
    </ThreadPrimitive.Root>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom border-border bg-background hover:bg-accent absolute -top-12 z-10 self-center !size-9 rounded-full disabled:invisible"
      >
        <ArrowDownToLineIcon className="size-4 text-muted-foreground/70" />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

const ThreadWelcome: FC = () => {
  return (
    <div className="aui-thread-welcome-root mx-auto mb-6 flex w-full max-w-(--thread-max-width) flex-col items-center px-4 text-center">
      <h1 className="aui-thread-welcome-message-inner fade-in slide-in-from-bottom-1 animate-in fill-mode-both text-2xl font-semibold duration-200">
        How can I help you today?
      </h1>
    </div>
  );
};

type SuggestionGroup = {
  label: string;
  icon: ReactNode;
  options: { label: string; prompt: string }[];
};

const SUGGESTION_GROUPS: SuggestionGroup[] = [
  {
    label: "Weather",
    icon: <CloudSunIcon />,
    options: [
      {
        label: "in San Francisco",
        prompt: "What's the weather in San Francisco?",
      },
      { label: "in Singapore", prompt: "What's the weather in Singapore?" },
      { label: "in Tokyo", prompt: "What's the weather in Tokyo?" },
      { label: "in London", prompt: "What's the weather in London?" },
    ],
  },
  {
    label: "Code",
    icon: <CodeXmlIcon />,
    options: [
      {
        label: "explain React hooks",
        prompt: "Explain React hooks like useState and useEffect",
      },
      {
        label: "write a debounce function",
        prompt: "Write a debounce function in TypeScript",
      },
      {
        label: "review a useEffect cleanup",
        prompt: "Show me the right way to clean up a subscription in useEffect",
      },
    ],
  },
  {
    label: "Write",
    icon: <PencilLineIcon />,
    options: [
      {
        label: "a product announcement",
        prompt: "Draft a short product announcement for a new dark mode",
      },
      {
        label: "release notes",
        prompt:
          "Write release notes for a bugfix release of a React component library",
      },
      {
        label: "a PR description",
        prompt:
          "Write a pull request description for a change that adds keyboard shortcuts",
      },
    ],
  },
  {
    label: "Analyze",
    icon: <ChartColumnIcon />,
    options: [
      {
        label: "React vs Vue vs Svelte",
        prompt: "Compare React, Vue, and Svelte in a table",
      },
      {
        label: "GDP of US, China, Japan",
        prompt:
          "Compare the GDP of the United States, China, and Japan in a table",
      },
      {
        label: "pros and cons of SSR",
        prompt: "What are the pros and cons of server-side rendering?",
      },
    ],
  },
  {
    label: "Brainstorm",
    icon: <LightbulbIcon />,
    options: [
      {
        label: "side project ideas",
        prompt: "Brainstorm five side project ideas for a React developer",
      },
      {
        label: "names for a dev tool",
        prompt: "Brainstorm names for a developer tools startup",
      },
      {
        label: "talk topics",
        prompt: "Brainstorm talk topics for a React meetup",
      },
    ],
  },
];

const suggestionChipClass =
  "aui-thread-welcome-suggestion text-foreground hover:bg-muted border-border/60 h-auto gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-normal whitespace-nowrap transition-colors [&_svg]:size-4";

const ThreadSuggestions: FC = () => {
  const aui = useAui();
  const [expandedLabel, setExpandedLabel] = useState<string | null>(null);
  const expandedGroup = SUGGESTION_GROUPS.find(
    (group) => group.label === expandedLabel,
  );

  const sendPrompt = (prompt: string) => {
    if (aui.thread().getState().isRunning) return;
    aui.thread().append({
      content: [{ type: "text", text: prompt }],
      runConfig: aui.composer().getState().runConfig,
    });
  };

  return (
    <div className="aui-thread-welcome-suggestions relative flex w-full flex-col gap-2 px-4">
      <div className="w-full scrollbar-none overflow-x-auto">
        <div className="mx-auto flex w-max items-center gap-2">
          {SUGGESTION_GROUPS.map((group, i) => (
            <Button
              key={group.label}
              variant="ghost"
              className={cn(
                suggestionChipClass,
                "animate-in fade-in slide-in-from-bottom-3 fill-mode-both duration-400",
                group.label === expandedLabel && "bg-muted",
              )}
              style={{ animationDelay: `${i * 80}ms` }}
              onClick={() =>
                setExpandedLabel(
                  group.label === expandedLabel ? null : group.label,
                )
              }
            >
              {group.icon}
              {group.label}
            </Button>
          ))}
        </div>
      </div>
      {expandedGroup && (
        <div
          key={expandedGroup.label}
          className="fade-in slide-in-from-top-1 animate-in absolute left-0 right-0 top-full z-10 w-full scrollbar-none overflow-x-auto pt-1 duration-200"
        >
          <div className="mx-auto flex w-max items-center gap-2">
            {expandedGroup.options.map((option) => (
              <Button
                key={option.label}
                variant="ghost"
                className={suggestionChipClass}
                onClick={() => sendPrompt(option.prompt)}
              >
                {option.label}
              </Button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const slashCommands: readonly Unstable_SlashCommand[] = [
  {
    id: "summarize",
    description: "Summarize the conversation",
    icon: "FileText",
    execute: () => console.log("[base example] /summarize invoked"),
  },
  {
    id: "translate",
    description: "Translate text to another language",
    icon: "Languages",
    execute: () => console.log("[base example] /translate invoked"),
  },
  {
    id: "search",
    description: "Search the web for information",
    icon: "Globe",
    execute: () => console.log("[base example] /search invoked"),
  },
  {
    id: "help",
    description: "List available commands",
    icon: "HelpCircle",
    execute: () => console.log("[base example] /help invoked"),
  },
];

const slashIconMap: Record<string, FC<{ className?: string }>> = {
  FileText: FileTextIcon,
  Languages: LanguagesIcon,
  Globe: GlobeIcon,
  HelpCircle: HelpCircleIcon,
};

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
  askUserPending: any;
  onRespondPermission: (approved: boolean) => void;
  onRespondAskUser: (answer: string) => void;
}> = ({
  permissionPending,
  askUserPending,
  onRespondPermission,
  onRespondAskUser,
}) => {
  if (permissionPending) {
    return (
      <div data-slot="aui-permission-blocker" className="mb-2 w-full">
        <PermissionBar pending={permissionPending} onRespond={onRespondPermission} />
      </div>
    );
  }

  if (askUserPending) {
    return null;
  }

  return null;
};

const PLACEHOLDERS = [
  "Ask me anything...",
  "What would you like to do?",
  "Type a message...",
  "How can I help?",
  "Got a question?",
  "What's on your mind?",
];

const Composer: FC = () => {
  const [showAnimated, setShowAnimated] = useState(true);

  useEffect(() => {
    const shell = document.querySelector(
      "[data-slot='aui_composer-shell']"
    ) as HTMLElement;
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
  const slash = unstable_useSlashCommandAdapter({
    commands: slashCommands,
    iconMap: slashIconMap,
    fallbackIcon: SlashIcon,
  });

  const { pending: permissionPending, respond: respondPermission } =
    usePermissionPoller();
  const { pending: askUserPending, respond: respondAskUser } =
    useAskUserPoller();

  return (
    <ComposerPrimitive.Unstable_TriggerPopoverRoot>
      <ComposerPrimitive.Root className="aui-composer-root relative flex w-full flex-col">
        <PermissionBlocker
          permissionPending={permissionPending}
          askUserPending={askUserPending}
          onRespondPermission={respondPermission}
          onRespondAskUser={respondAskUser}
        />
        <ComposerPrimitive.AttachmentDropzone asChild>
          <div
            data-slot="aui_composer-shell"
            className="border-border/60 data-[dragging=true]:border-ring focus-within:border-border dark:border-muted-foreground/15 dark:focus-within:border-muted-foreground/30 flex w-full flex-col gap-2 rounded-(--composer-radius) border bg-(--composer-bg) p-(--composer-padding) shadow-[0_4px_16px_-8px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] focus-within:shadow-[0_6px_24px_-8px_rgba(0,0,0,0.12),0_1px_2px_rgba(0,0,0,0.05)] data-[dragging=true]:border-dashed data-[dragging=true]:bg-[color-mix(in_oklab,var(--color-accent)_50%,var(--color-background))] dark:shadow-none"
          >
            <motion.div layout transition={{ duration: 0.15 }}>
              <AnimatePresence mode="wait">
                {askUserPending ? (
                  <motion.div
                    key="ask-user"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <AskUserBar question={askUserPending} onRespond={respondAskUser} />
                  </motion.div>
                ) : (
                  <motion.div
                    key="composer-input"
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -8 }}
                    transition={{ duration: 0.15 }}
                  >
                    <ComposerQuotePreview />
                    <ComposerAttachments />
                    <div className="relative">
                      <LexicalComposerInput
                        directiveChip={DirectiveChip}
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
                )}
              </AnimatePresence>
            </motion.div>
            <motion.div layout transition={{ duration: 0.15 }}>
              {!askUserPending && !permissionPending && <ComposerAction />}
            </motion.div>
          </div>
        </ComposerPrimitive.AttachmentDropzone>

        <ComposerTriggerPopover char="@" {...mention} />

        <ComposerTriggerPopover
          char="/"
          {...slash}
          emptyItemsLabel="No matching commands"
        />
      </ComposerPrimitive.Root>
    </ComposerPrimitive.Unstable_TriggerPopoverRoot>
  );
};

const ComposerAction: FC = () => {
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
        <AuiIf condition={(s) => !s.thread.isRunning}>
          <ComposerPrimitive.Send asChild>
            <TooltipIconButton
              tooltip="Send message"
              side="bottom"
              type="button"
              variant="default"
              size="icon"
               className="aui-composer-send flex !size-7 items-center justify-center !rounded-full bg-primary text-primary-foreground shadow-[0_0_0_2px_color-mix(in_oklab,var(--color-primary)_20%,transparent)] hover:bg-primary/90"
              aria-label="Send message"
            >
              <ArrowUpIcon className="aui-composer-send-icon size-4.5" />
            </TooltipIconButton>
          </ComposerPrimitive.Send>
        </AuiIf>
        <AuiIf condition={(s) => s.thread.isRunning}>
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
        </AuiIf>
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
};

function getToolLabel(part: ToolCallMessagePart): string {
  return (part.args as any)?.label || TOOL_GROUP_TITLES[part.toolName] || part.toolName;
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
  const labels = parts.map(getToolLabel);
  const title = labels[labels.length - 1] || "Performing operations";
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
        <MessagePrimitive.GroupedParts
          groupBy={groupPartByType({
            reasoning: ["group-chainOfThought", "group-reasoning"],
            "tool-call": ["group-chainOfThought", "group-tool"],
            "standalone-tool-call": [],
          })}
        >
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
                const rawText = (part as { text?: string }).text || "";
                const extPattern = "(pptx?|docx?|xlsx?|pdf|csv|zip|png|jpe?g|gif|svg)";
                const fileRefs = [
                  ...rawText.matchAll(new RegExp(`\\[file:\\s*(.+?)\\]`, "gi")),
                  ...rawText.matchAll(new RegExp(`\\[(?!file:)([^\\]]+\\.${extPattern})\\]`, "gi")),
                ];
                if (!fileRefs.length) return <MarkdownText />;

                return (
                  <>
                    <MarkdownTextPrimitive
                      remarkPlugins={[remarkGfm]}
                      components={defaultComponents}
                      preprocess={(t: string) => t
                        .replace(/<script[\s\S]*?<\/script>/gi, "")
                        .replace(/<script\b[^>]*\/>/gi, "")
                        .replace(new RegExp(`\\[file:\\s*.+?\\]|\\[[^\\]]+\\.${extPattern}\\]`, "gi"), "").trim()}
                    />
                    {fileRefs.map(([, path, fallbackExt], i) => {
                      const filePath = (path || fallbackExt).trim();
                      const filename = filePath.split("/").pop() || filePath;
                      const isExternal = filePath.startsWith("/") || filePath.startsWith("~");
                  const downloadUrl = isExternal
                        ? `/api/external-files/${filePath.replace(/^\//, "")}`
                        : `/api/files/${filePath}`;
                      return (
                        <div key={i} className="my-2">
                          <FileCard
                            filename={filename}
                            filePath={filePath}
                            downloadUrl={downloadUrl}
                          />
                        </div>
                      );
                    })}
                  </>
                );
              }
              case "reasoning":
                return <Reasoning {...part} />;
              case "tool-call":
                return (
                  <ToolGroupRoot variant="ghost" defaultOpen={false}>
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
        <MessageError />
      </div>

      <div
        data-slot="aui_assistant-message-footer"
        className={cn("ml-2 flex items-center", ACTION_BAR_HEIGHT)}
      >
        <BranchPicker />
        <AssistantActionBar />
      </div>
    </MessagePrimitive.Root>
  );
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
          <ActionBarPrimitive.ExportMarkdown asChild>
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

      <BranchPicker
        data-slot="aui_user-branch-picker"
        className="col-span-full col-start-1 row-start-3 -mr-1 justify-end"
      />
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

const BranchPicker: FC<BranchPickerPrimitive.Root.Props> = ({
  className,
  ...rest
}) => {
  return (
    <BranchPickerPrimitive.Root
      hideWhenSingleBranch
      className={cn(
        "aui-branch-picker-root text-muted-foreground mr-2 -ml-2 inline-flex items-center text-xs",
        className,
      )}
      {...rest}
    >
      <BranchPickerPrimitive.Previous asChild>
        <TooltipIconButton tooltip="Previous">
          <ChevronLeftIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Previous>
      <span className="aui-branch-picker-state font-medium">
        <BranchPickerPrimitive.Number /> / <BranchPickerPrimitive.Count />
      </span>
      <BranchPickerPrimitive.Next asChild>
        <TooltipIconButton tooltip="Next">
          <ChevronRightIcon />
        </TooltipIconButton>
      </BranchPickerPrimitive.Next>
    </BranchPickerPrimitive.Root>
  );
};

export const Base: FC = () => {
  return (
    <div className="bg-muted flex h-full w-full">
      <div>
        <Sidebar />
      </div>
      <div className="flex flex-1 flex-col overflow-hidden p-2 md:pl-0">
        <div className="bg-background flex flex-1 flex-col overflow-hidden rounded-lg">
          <main className="flex-1 overflow-hidden">
            <Thread />
          </main>
        </div>
      </div>
    </div>
  );
};
