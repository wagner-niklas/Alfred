import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  CopyIcon,
  PencilIcon,
  RepeatIcon,
  Square,
  Search as SearchIcon,
} from "lucide-react";
import { HugeiconsIcon } from "@hugeicons/react";
import { SaturnIcon } from "@hugeicons/core-free-icons";

import {
  ActionBarPrimitive,
  AuiIf,
  BranchPickerPrimitive,
  ComposerPrimitive,
  ErrorPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useAui,
} from "@assistant-ui/react";

import type { FC } from "react";
import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import * as m from "motion/react-m";

import { Button } from "@/components/ui/button";
import { MarkdownText } from "@/components/assistant-ui/markdown-text";
import { Reasoning, ReasoningGroup } from "@/components/assistant-ui/reasoning";
import { ToolFallback } from "@/components/alfred/tool-fallback";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import {
  ComposerAddAttachment,
  ComposerAttachments,
  UserMessageAttachments,
} from "@/components/alfred/attachment";
import { useState, useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

export const Thread: FC = () => {
  return (
    <LazyMotion features={domAnimation}>
      <MotionConfig reducedMotion="user">
        <ThreadPrimitive.Root
          className="aui-root aui-thread-root @container flex h-full flex-col bg-background"
          style={{
            ["--thread-max-width" as string]: "42rem",
          }}
        >
          <ThreadPrimitive.Viewport
            turnAnchor="top"
            autoScroll
            className="aui-thread-viewport relative flex flex-1 flex-col overflow-x-auto overflow-y-scroll scroll-smooth px-4 pt-4"
          >     
            {/* EMPTY STATE: welcome + smaller input, slightly higher on the page */}
            <ThreadPrimitive.If empty>
              <div className="flex flex-1 items-start justify-center pt-14 md:pt-35">
                <div className="flex w-full max-w-[var(--thread-max-width)] flex-col items-center">
                  <ThreadWelcome />

                  {/* Composer (empty thread): generic prompt + inline examples */}
                  <div className="mt-10 w-full flex justify-center">
                    <Composer
                      variant="compact"
                      placeholder="Ask me anything..."
                    />
                  </div>
                </div>
              </div>
            </ThreadPrimitive.If>

            {/* NON-EMPTY STATE: original layout + normal-sized input */}
            <ThreadPrimitive.If empty={false}>
              <div className="flex h-full w-full flex-col items-stretch">
                <ThreadPrimitive.Messages
                  components={{
                    UserMessage,
                    EditComposer,
                    AssistantMessage,
                  }}
                />

                
                <ThreadPrimitive.ViewportFooter className="aui-thread-viewport-footer sticky bottom-0 mx-auto mt-auto flex w-full max-w-(--thread-max-width) flex-col overflow-visible rounded-t-3xl bg-background pb-4 md:pb-2">
                <ThreadScrollToBottom />
                {/* Composer (non-empty thread): follow-up prompt */}
                <Composer
                  variant="default"
                  placeholder="Ask a follow-up question"
                />

                {/* AI Disclaimer only for follow-up prompts */}
                <div className="aui-composer-disclaimer text-xs text-muted-foreground text-center mx-auto">
                  AI can make mistakes. Please verify critical information.
                </div>
                </ThreadPrimitive.ViewportFooter>

              </div>
            </ThreadPrimitive.If>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>
      </MotionConfig>
    </LazyMotion>
  );
};

const ThreadScrollToBottom: FC = () => {
  return (
    <ThreadPrimitive.ScrollToBottom asChild>
      <TooltipIconButton
        tooltip="Scroll to bottom"
        variant="outline"
        className="aui-thread-scroll-to-bottom absolute -top-12 z-10 self-center rounded-full p-4 disabled:invisible dark:bg-background dark:hover:bg-accent"
      >
        <ArrowDownIcon />
      </TooltipIconButton>
    </ThreadPrimitive.ScrollToBottom>
  );
};

  const THREAD_SLOGANS = [
    "Bring it on.",
    "Ready when you are.",
    "How can I assist you today?",
    "Your data companion.",
    "Ask me anything.",
    "Here to help.",
    "Let's get started.",
    "Data at your fingertips.",
  ];

const ThreadWelcome: FC = () => {
  const [slogan, setSlogan] = useState<string>(THREAD_SLOGANS[0]);

  useEffect(() => {
    const random =
      THREAD_SLOGANS[Math.floor(Math.random() * THREAD_SLOGANS.length)];
    setSlogan(random);
  }, []);

  return (
    <div className="aui-thread-welcome-root mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col items-center">
      {/* Centered heading block */}
      <div className="aui-thread-welcome-message w-full px-8 text-center">
        {/* Icon and slogan in one row */}
        <m.div
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.8 }}
          className="mb-3 inline-flex items-center gap-3"
        >
          <HugeiconsIcon icon={SaturnIcon} className="h-8 w-8 text-primary" />
          <m.h2
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ delay: 0.05 }}
            className="aui-thread-welcome-message-motion-1 text-2xl shimmer shimmer-duration-5000 leading-tight font-sans"
            style={{
              fontWeight: "normal",
            }}
          >
            {slogan}
          </m.h2>
        </m.div>

        <m.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 10 }}
          transition={{ delay: 0.1 }}
          className="aui-thread-welcome-message-motion-2 mt-2 text-xl text-muted-foreground/65"
        >
          {/* Optional additional text here */}
        </m.div>
      </div>
    </div>
  );
};

type ThreadSuggestionsProps = {
  isVisible?: boolean;
  query?: string;
};

const ThreadSuggestions: FC<ThreadSuggestionsProps> = ({ isVisible, query }) => {
  const [recentPrompts, setRecentPrompts] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;

    const extractText = (content: unknown): string => {
      // Helper to deal with cases where the text itself is a serialized
      // ai-sdk message (like the example you showed). We try to parse it
      // and, if it looks like a message object, recurse into its content.
      const fromMaybeSerialized = (text: string): string => {
        try {
          const parsed = JSON.parse(text);
          if (parsed && typeof parsed === "object") {
            if ("content" in parsed) {
              return extractText((parsed as any).content);
            }
            if ("parts" in parsed) {
              return extractText((parsed as any).parts);
            }
          }
        } catch {
          // Not JSON – treat as plain text.
        }
        return text;
      };

      if (typeof content === "string") {
        return fromMaybeSerialized(content);
      }

      if (Array.isArray(content)) {
        return content
          .map((part) => {
            if (typeof part === "string") return fromMaybeSerialized(part);

            if (part && typeof part === "object") {
              if ("text" in part && typeof (part as any).text === "string") {
                return fromMaybeSerialized((part as any).text);
              }
              if ("content" in part) {
                return extractText((part as any).content);
              }
            }
            return "";
          })
          .join(" ");
      }

      if (content && typeof content === "object") {
        // Full ai-sdk message object (id, format, content, ...)
        if ("content" in content) {
          return extractText((content as any).content);
        }

        if ("parts" in content && Array.isArray((content as any).parts)) {
          return extractText((content as any).parts);
        }

        if ("text" in content && typeof (content as any).text === "string") {
          return fromMaybeSerialized((content as any).text);
        }
      }

      try {
        return JSON.stringify(content);
      } catch {
        return "";
      }
    };

    const loadRecentFirstQuestions = async () => {
      try {
        const threadsRes = await fetch("/api/threads", { cache: "no-store" });
        if (!threadsRes.ok) return;

        const threads = (await threadsRes.json()) as Array<{
          id: string;
        }>;

        const recent: string[] = [];

        for (const t of threads) {
          if (recent.length >= 2) break;

          try {
            const messagesRes = await fetch(`/api/threads/${t.id}/messages`, {
              cache: "no-store",
            });
            if (!messagesRes.ok) continue;

            const messages = (await messagesRes.json()) as Array<{
              role: "user" | "assistant" | "system";
              content: unknown;
            }>;

            const firstUserMessage = messages.find(
              (m) => m.role === "user",
            );
            if (!firstUserMessage) continue;

            const text = extractText(firstUserMessage.content).trim();
            if (text) {
              recent.push(text);
            }
          } catch {
            // Best-effort only – failure to load one thread should not block others.
          }

          if (cancelled) return;
        }

        if (!cancelled) {
          setRecentPrompts(recent);
        }
      } catch {
        // Swallow errors – suggestions are a progressive enhancement.
      }
    };

    void loadRecentFirstQuestions();

    return () => {
      cancelled = true;
    };
  }, []);

  const staticSuggestions = [
    {
      action:
        "How many clients are in each district? Which has the most?",
    },
    {
      action:
        "What's the count of issued card types (credit, debit, prepaid)?",
    },
    {
      action:
        "How many accounts does each client have? Who has the most?",
    },

  ];

  const recentSuggestions = recentPrompts.map((prompt) => ({ action: prompt }));

  const normalizedQuery = (query ?? "").trim().toLowerCase();
  const matchesQuery = (text: string) =>
    !normalizedQuery || text.toLowerCase().includes(normalizedQuery);

  const filteredStaticSuggestions = staticSuggestions.filter((s) =>
    matchesQuery(s.action),
  );
  const filteredRecentSuggestions = recentSuggestions.filter((s) =>
    matchesQuery(s.action),
  );

  const hasSuggestions =
    filteredStaticSuggestions.length > 0 ||
    filteredRecentSuggestions.length > 0;

  if (!hasSuggestions) {
    return null;
  }

  return (
    <div
      className={cn(
        "aui-thread-welcome-suggestions mb-1 flex w-full flex-col gap-0.5 px-1.5 pb-1 transition-all duration-250 ease-out",
        isVisible
          ? "opacity-100 translate-y-0"
          : "opacity-0 translate-y-1 pointer-events-none",
      )}
    >
      {/* Fine grey line between composer and suggestions, slightly inset left/right */}
      <div className="mt-1 pt-1">
        <div className="pointer-events-none mx-2 border-t border-border/60" />
      </div>
      {filteredStaticSuggestions.map((suggestedAction, index) => (
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * index }}
          key={`suggested-action-${index}-${suggestedAction.action.slice(0, 32)}`}
          className="aui-thread-welcome-suggestion-display"
        >
          <ThreadPrimitive.Suggestion
            prompt={suggestedAction.action}
            send
            asChild
          >
            <Button
              variant="ghost"
              className="aui-thread-welcome-suggestion h-auto w-full flex flex-nowrap items-center justify-start gap-2 rounded-xl border-none px-4 py-2.5 text-left text-sm dark:hover:bg-accent/60"
              // Prevent the textarea from blurring before the suggestion click
              // is handled, so the suggestion can still trigger a send.
              onMouseDown={(e) => e.preventDefault()}
              aria-label={suggestedAction.action}
            >
              <SearchIcon className="aui-thread-welcome-suggestion-icon mr-1 h-4 w-4 flex-shrink-0 text-muted-foreground/80" />
              <span className="aui-thread-welcome-suggestion-text-1 text-muted-foreground">
                {suggestedAction.action}
              </span>
            </Button>
          </ThreadPrimitive.Suggestion>
        </m.div>
      ))}

      {filteredRecentSuggestions.length > 0 && (
        <div className="aui-thread-welcome-suggestions-recent-label flex items-center gap-1.5 px-3 pt-1 text-xs font-medium text-muted-foreground/70">
          <span>Recent</span>
        </div>
      )}

      {filteredRecentSuggestions.map((suggestedAction, index) => (
        <m.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ delay: 0.05 * (staticSuggestions.length + index) }}
          key={`suggested-recent-action-${index}-${suggestedAction.action.slice(0, 32)}`}
          className="aui-thread-welcome-suggestion-display"
        >
          <ThreadPrimitive.Suggestion
            prompt={suggestedAction.action}
            send
            asChild
          >
            <Button
              variant="ghost"
              className="aui-thread-welcome-suggestion h-auto w-full flex flex-nowrap items-center justify-start gap-1.5 rounded-xl border-none px-4 py-2.5 text-left text-sm dark:hover:bg-accent/60"
              onMouseDown={(e) => e.preventDefault()}
              aria-label={suggestedAction.action}
            >
              <ClockIcon className="aui-thread-welcome-suggestion-icon mr-1 h-4 w-4 flex-shrink-0 text-muted-foreground/80" />
              <span className="aui-thread-welcome-suggestion-text-1 truncate text-muted-foreground">
                {suggestedAction.action}
              </span>
            </Button>
          </ThreadPrimitive.Suggestion>
        </m.div>
      ))}
    </div>
  );
};

type ComposerVariant = "compact" | "default";

type ComposerProps = {
  wrapperClassName?: string;
  variant?: ComposerVariant;
  placeholder?: string;
};

const Composer: FC<ComposerProps> = ({
  wrapperClassName,
  variant = "default",
  placeholder = "Ask me anything ...",
}) => {
  const isCompact = variant === "compact";
  const [isFocused, setIsFocused] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const router = useRouter();
  const pathname = usePathname();
  const aui = useAui() as any;

  // When composing on the top-level /alfred route ("New thread"),
  // automatically navigate to /alfred/[threadId] after the first
  // message is submitted so the URL always reflects the active thread.
  //
  // We hook into the form submit capture phase so this runs whether
  // the user clicks the send button or presses Enter, while still
  // letting Assistant UI handle the actual send behavior.
  const handleSubmitCapture = async () => {
    // Only redirect from the generic Alfred entry page; once a concrete
    // thread URL is active (/alfred/[id]), we no longer interfere.
    if (pathname !== "/alfred") return;

    try {
      if (typeof aui.threadListItem !== "function") return;

      const item = aui.threadListItem();
      const { remoteId } = await item.initialize();
      if (!remoteId) return;

      router.push(`/alfred/${encodeURIComponent(remoteId)}`);
    } catch (error) {
      // Best-effort only – a failure here should not block sending.
      console.error("Failed to redirect to Alfred thread page", error);
    }
  };

  // Control mounting/unmounting of suggestions so that:
  // - When focused: suggestions fade in and take space.
  // - Shortly after blur: suggestions fade out, then unmount so the composer
  //   returns to its original height ("as before").
  useEffect(() => {
    if (!isCompact) return;

    if (isFocused) {
      setShowSuggestions(true);
      return;
    }

    const timeout = setTimeout(() => {
      setShowSuggestions(false);
    }, 250); // match ThreadSuggestions transition duration

    return () => clearTimeout(timeout);
  }, [isCompact, isFocused]);

  return (
    <div
      className={cn(
        "aui-composer-wrapper sticky bottom-0 mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col overflow-visible rounded-t-3xl bg-background",
        // Use tighter spacing so the disclaimer sits closer to the composer
        isCompact ? "gap-2 pb-2 md:pb-3" : "gap-2 pb-2 md:pb-3",
        wrapperClassName
      )}
    >
      <ThreadScrollToBottom />
      <ComposerPrimitive.Root
        className="aui-composer-root group/input-group relative flex w-full flex-col rounded-3xl border border-input bg-card px-1 pt-2 shadow-xs transition-[color,box-shadow] outline-none has-[textarea:focus-visible]:border-ring has-[textarea:focus-visible]:ring-[3px] has-[textarea:focus-visible]:ring-ring/50 dark:bg-card"
        onSubmitCapture={handleSubmitCapture}
      >
        <ComposerAttachments />
        <ComposerPrimitive.Input
          placeholder={placeholder}
          className={cn(
            "aui-composer-input mb-1 w-full resize-none bg-transparent px-3.5 pt-1.5 text-base outline-none placeholder:text-muted-foreground focus-visible:ring-0",
            variant === "default" ? "min-h-8" : "min-h-16 max-h-32"
          )}
          rows={1}
          autoFocus
          aria-label="Message input"
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onChange={(event) => setInputValue(event.target.value)}
        />
        <ComposerAction />
        {/* Inline example suggestions only for compact composer.
            They fade in/out on focus change and unmount after blur
            so the composer returns to its original height. */}
        {isCompact && showSuggestions && (
          <ThreadSuggestions isVisible={isFocused} query={inputValue} />
        )}
      </ComposerPrimitive.Root>
    </div>
  );
};

const ComposerAction: FC = () => {
  return (
    <div className="aui-composer-action-wrapper relative mx-1 mt-2 mb-2 flex items-center justify-between">
      <ComposerAddAttachment />

      <ThreadPrimitive.If running={false}>
        <ComposerPrimitive.Send asChild>
          <TooltipIconButton
            tooltip="Send message"
            side="bottom"
            type="submit"
            variant="default"
            size="icon"
            className="aui-composer-send size-[34px] rounded-full p-1"
            aria-label="Send message"
          >
            <ArrowUpIcon className="aui-composer-send-icon size-5" />
          </TooltipIconButton>
        </ComposerPrimitive.Send>
      </ThreadPrimitive.If>

      <ThreadPrimitive.If running>
        <ComposerPrimitive.Cancel asChild>
          <Button
            type="button"
            variant="default"
            size="icon"
            className="aui-composer-cancel size-[34px] rounded-full border border-muted-foreground/60 hover:bg-primary/75 dark:border-muted-foreground/90"
            aria-label="Stop generating"
          >
            <Square className="aui-composer-cancel-icon size-3.5 fill-white dark:fill-black" />
          </Button>
        </ComposerPrimitive.Cancel>
      </ThreadPrimitive.If>
    </div>
  );
};

const MessageError: FC = () => {
  return (
    <MessagePrimitive.Error>
      <ErrorPrimitive.Root className="aui-message-error-root mt-2 rounded-md border border-destructive bg-destructive/10 p-3 text-sm text-destructive dark:bg-destructive/5 dark:text-red-200">
        <ErrorPrimitive.Message className="aui-message-error-message line-clamp-2" />
      </ErrorPrimitive.Root>
    </MessagePrimitive.Error>
  );
};

const AssistantMessage: FC = () => {
  return (
    <MessagePrimitive.Root asChild>
      <div
        className="aui-assistant-message-root relative mx-auto w-full max-w-[var(--thread-max-width)] animate-in py-4 duration-150 ease-out fade-in slide-in-from-bottom-1 last:mb-24"
        data-role="assistant"
      >
        <div className="aui-assistant-message-content mx-2 leading-7 break-words text-foreground">
          <MessagePrimitive.Parts
            components={{
              Text: MarkdownText,
              Reasoning: Reasoning,
              ReasoningGroup: ReasoningGroup,
              tools: { Fallback: ToolFallback },
            }}

          />
          <MessageError />
        <AuiIf
          // Show the "thinking" indicator only for the most recent message, and only while it's still generating.
          condition={(s) => s.thread.isRunning && s.thread.messages[s.thread.messages.length - 1]?.id === s.message.id}
        >
          <div className="flex items-center gap-2 text-muted-foreground">
                <HugeiconsIcon icon={SaturnIcon} className="size-6 animate-pulse text-primary" />
          </div>
        </AuiIf>
        </div>

        <div className="aui-assistant-message-footer mt-2 ml-2 flex">
          <BranchPicker />
          <AssistantActionBar />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
};

const AssistantActionBar: FC = () => {
  return (
    <ActionBarPrimitive.Root
      hideWhenRunning
      autohide="not-last"
      autohideFloat="single-branch"
      className="aui-assistant-action-bar-root col-start-3 row-start-2 -ml-1 flex gap-1 text-muted-foreground data-floating:absolute data-floating:rounded-md data-floating:border data-floating:bg-background data-floating:p-1 data-floating:shadow-sm"
    >
      {/* COPY */}
      <ActionBarPrimitive.Copy asChild>
        <TooltipIconButton tooltip="Copy">
          <MessagePrimitive.If copied>
            <CheckIcon />
          </MessagePrimitive.If>
          <MessagePrimitive.If copied={false}>
            <CopyIcon />
          </MessagePrimitive.If>
        </TooltipIconButton>
      </ActionBarPrimitive.Copy>

      {/* RELOAD */}
      <ActionBarPrimitive.Reload asChild>
        <TooltipIconButton tooltip="Rewrite Thread">
          <RepeatIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Reload>
    </ActionBarPrimitive.Root>
  );
};

const UserMessage: FC = () => {
  return (
    <MessagePrimitive.Root asChild>
      <div
        className="aui-user-message-root mx-auto grid w-full max-w-[var(--thread-max-width)] animate-in auto-rows-auto grid-cols-[minmax(72px,1fr)_auto] gap-y-2 px-2 py-4 duration-150 ease-out fade-in slide-in-from-bottom-1 first:mt-3 last:mb-5 [&:where(>*)]:col-start-2"
        data-role="user"
      >
        <UserMessageAttachments />

        <div className="aui-user-message-content-wrapper relative col-start-2 min-w-0">
          <div className="aui-user-message-content rounded-3xl bg-muted px-5 py-2.5 break-words text-foreground">
            <MessagePrimitive.Parts />
          </div>
          <div className="aui-user-action-bar-wrapper absolute top-1/2 left-0 -translate-x-full -translate-y-1/2 pr-2">
            <UserActionBar />
          </div>
        </div>

        <BranchPicker className="aui-user-branch-picker col-span-full col-start-1 row-start-3 -mr-1 justify-end" />
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
        <TooltipIconButton tooltip="Edit query" className="aui-user-action-edit p-4">
          <PencilIcon />
        </TooltipIconButton>
      </ActionBarPrimitive.Edit>
    </ActionBarPrimitive.Root>
  );
};

const EditComposer: FC = () => {
  return (
    <div className="aui-edit-composer-wrapper mx-auto flex w-full max-w-[var(--thread-max-width)] flex-col gap-4 px-2 first:mt-4">
      <ComposerPrimitive.Root className="aui-edit-composer-root ml-auto flex w-full max-w-7/8 flex-col rounded-xl bg-muted">
        <ComposerPrimitive.Input
          className="aui-edit-composer-input flex min-h-[60px] w-full resize-none bg-transparent p-4 text-foreground outline-none"
          autoFocus
        />

        <div className="aui-edit-composer-footer mx-3 mb-3 flex items-center justify-center gap-2 self-end">
          <ComposerPrimitive.Cancel asChild>
            <Button variant="ghost" size="sm" aria-label="Cancel edit">
              Cancel
            </Button>
          </ComposerPrimitive.Cancel>
          <ComposerPrimitive.Send asChild>
            <Button size="sm" aria-label="Update message">
              Update
            </Button>
          </ComposerPrimitive.Send>
        </div>
      </ComposerPrimitive.Root>
    </div>
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
        "aui-branch-picker-root mr-2 -ml-2 inline-flex items-center text-xs text-muted-foreground",
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
