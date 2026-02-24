import type { ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CheckIcon, ChevronDownIcon, Loader2Icon, XCircleIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

/**
 * ToolFallback
 * ------------
 *
 * Renders a single tool call in a compact, reasoning-style "composer" row
 * that can be expanded to show full details (arguments, result, cancel reason).
 *
 * This mirrors the UX of the Reasoning components:
 *  - collapsed row under the message with an icon + label
 *  - chevron that rotates when expanded
 *  - content panel that appears below with a subtle card treatment
 */
export const ToolFallback: ToolCallMessagePartComponent = ({
  toolName,
  argsText,
  result,
  status,
}) => {
  const isCancelled =
    status?.type === "incomplete" && status.reason === "cancelled";
  const isRunning = status?.type === "running";

  const cancelledReason =
    isCancelled && status.error
      ? typeof status.error === "string"
        ? status.error
        : JSON.stringify(status.error)
      : null;

  const [open, setOpen] = useState(Boolean(isRunning));

  // Auto-expand while the tool is running, then collapse once it finishes.
  const prevIsRunningRef = useRef(isRunning);

  useEffect(() => {
    const prevIsRunning = prevIsRunningRef.current;

    if (isRunning) {
      // Ensure details are visible while the tool is executing.
      setOpen(true);
    } else if (prevIsRunning && !isRunning) {
      // Once a previously running tool finishes (success or cancelled),
      // collapse the panel by default. The user can still re-open it manually.
      setOpen(false);
    }

    prevIsRunningRef.current = isRunning;
  }, [isRunning]);

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className={cn("aui-tool-fallback-root mb-2 w-full text-sm")}
    >
      <CollapsibleTrigger
        className={cn(
          "aui-tool-fallback-trigger group/trigger -mb-1 inline-flex max-w-[90%] items-center gap-2 py-1 text-xs text-muted-foreground transition-colors hover:text-foreground",
          isCancelled && "opacity-80",
        )}
      >
        {isCancelled ? (
          <XCircleIcon className="aui-tool-fallback-icon size-3 shrink-0 text-muted-foreground" />
        ) : isRunning ? (
          <Loader2Icon className="aui-tool-fallback-icon size-3 shrink-0 animate-spin text-muted-foreground" />
        ) : (
          <CheckIcon className="aui-tool-fallback-icon size-3 shrink-0" />
        )}

        <span className="aui-tool-fallback-label flex min-w-0 items-center gap-1 truncate">
          <span
            className={cn(
              "truncate",
              isCancelled && "line-through text-muted-foreground",
            )}
          >
            Tool: <b>{toolName}</b>
          </span>
          {isRunning && (
            <span className="aui-tool-fallback-running-indicator shrink-0 text-[0.65rem] italic text-muted-foreground/80">
              running…
            </span>
          )}
        </span>

        <ChevronDownIcon
          className={cn(
            "aui-tool-fallback-chevron ml-1 size-3 shrink-0 transition-transform duration-200",
            "group-data-[state=closed]/trigger:-rotate-90",
            "group-data-[state=open]/trigger:rotate-0",
          )}
        />
      </CollapsibleTrigger>

      <CollapsibleContent
        className={cn(
          "aui-tool-fallback-content group/collapsible-content mt-1 overflow-hidden rounded-md border bg-muted/40 text-xs text-muted-foreground",
          "data-[state=open]:animate-collapsible-down",
          "data-[state=closed]:animate-collapsible-up",
        )}
      >
        <div className="space-y-3 p-3">
          {cancelledReason && (
            <div className="aui-tool-fallback-cancelled-root space-y-1">
              <p className="aui-tool-fallback-cancelled-header text-[0.7rem] font-semibold uppercase tracking-wide text-muted-foreground">
                Cancelled
              </p>
              <p className="aui-tool-fallback-cancelled-reason whitespace-pre-wrap text-[0.7rem] text-muted-foreground">
                {cancelledReason}
              </p>
            </div>
          )}

          <div
            className={cn(
              "aui-tool-fallback-args-root space-y-1",
              isCancelled && "opacity-70",
            )}
          >
            <p className="aui-tool-fallback-args-header text-[0.7rem] font-semibold uppercase tracking-wide">
              Arguments
            </p>
            <pre className="aui-tool-fallback-args-value max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-[0.7rem]">
              {argsText}
            </pre>
          </div>

          {!isCancelled && result !== undefined && (
            <div className="aui-tool-fallback-result-root space-y-1 border-t border-dashed pt-2">
              <p className="aui-tool-fallback-result-header text-[0.7rem] font-semibold uppercase tracking-wide">
                Result
              </p>
              <pre className="aui-tool-fallback-result-content max-h-64 overflow-auto whitespace-pre-wrap rounded bg-background/60 p-2 text-[0.7rem]">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
};
