import type { FC } from "react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ThreadListItemPrimitive,
  ThreadListPrimitive,
  useAssistantState,
  useAui,
} from "@assistant-ui/react";
import { ArchiveIcon, PencilIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipIconButton } from "@/components/assistant-ui/tooltip-icon-button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";

type ThreadMetaRecord = {
  id: string;
  updatedAt?: string;
};

const ThreadMetaContext = createContext<Record<string, ThreadMetaRecord> | null>(
  null,
);

export const ThreadList: FC = () => {
  // Optional metadata for threads (e.g. updatedAt) fetched from our API.
  const [metaById, setMetaById] = useState<Record<string, ThreadMetaRecord>>({});

  const { threadIds } = useAssistantState(({ threads }) => threads);

  useEffect(() => {
    let cancelled = false;

    const loadMeta = async () => {
      try {
        const res = await fetch("/api/threads", { cache: "no-store" });
        if (!res.ok) return;

        const data = (await res.json()) as Array<{
          id: string;
          updatedAt?: string;
        }>;

        if (!cancelled) {
          const map: Record<string, ThreadMetaRecord> = {};
          for (const t of data) {
            map[t.id] = { id: t.id, updatedAt: t.updatedAt };
          }
          setMetaById(map);
        }
      } catch {
        // Best-effort only: if this fails, we just don't show day labels.
      }
    };

    // Refetch when the number of threads changes so new chats get metadata,
    // but do not use this metadata to drive ordering or selection.
    loadMeta();

    return () => {
      cancelled = true;
    };
  }, [threadIds.length]);

  return (
    <ThreadMetaContext.Provider value={metaById}>
      <ThreadListPrimitive.Root className="aui-root aui-thread-list-root flex flex-col items-stretch gap-1.5">
        <ThreadListNew />
        <ThreadListItems />
      </ThreadListPrimitive.Root>
    </ThreadMetaContext.Provider>
  );
};

const ThreadListNew: FC = () => {
  return (
    <ThreadListPrimitive.New asChild>
      <Button
        className="aui-thread-list-new flex items-center justify-start gap-1 rounded-lg px-2.5 py-2 text-start text-foreground hover:bg-muted data-active:bg-muted"
        variant="ghost"
      >
        <PlusIcon />
        New Chat
      </Button>
    </ThreadListPrimitive.New>
  );
};

const ThreadListItems: FC = () => {
  const { isLoading } = useAssistantState(({ threads }) => threads);

  if (isLoading) {
    return <ThreadListSkeleton />;
  }

  // Simpler, single source of truth: delegate list rendering entirely to
  // Assistant UI's internal thread state. This avoids subtle timing
  // mismatches between our own /api/threads-based grouping and the
  // runtime, which can cause transient visual glitches (e.g. titles
  // appearing duplicated across threads on slower environments).
  return <ThreadListPrimitive.Items components={{ ThreadListItem }} />;
};

const ThreadListSkeleton: FC = () => {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <div
          key={i}
          role="status"
          aria-label="Loading threads"
          aria-live="polite"
          className="aui-thread-list-skeleton-wrapper flex items-center gap-2 rounded-md px-3 py-2"
        >
          <Skeleton className="aui-thread-list-skeleton h-[22px] flex-grow" />
        </div>
      ))}
    </>
  );
};

const ThreadListItem: FC = () => {
  const aui = useAui();
  const [isRenaming, setIsRenaming] = useState(false);

  const metaById = useContext(ThreadMetaContext);
  const { id } = aui.threadListItem().getState();

  const dayLabel = useMemo(() => {
    if (!metaById || !id) return "";
    const record = metaById[id as string];
    if (!record?.updatedAt) return "";

    const updated = new Date(record.updatedAt);
    if (Number.isNaN(updated.getTime())) return "";

    const startOfDay = (d: Date) => {
      const date = new Date(d);
      date.setHours(0, 0, 0, 0);
      return date;
    };

    const now = new Date();
    const todayStart = startOfDay(now);
    const yesterdayStart = new Date(todayStart);
    yesterdayStart.setDate(todayStart.getDate() - 1);
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setDate(todayStart.getDate() - 7);

    if (updated >= todayStart) return "Today";
    if (updated >= yesterdayStart && updated < todayStart) return "Yesterday";
    if (updated >= sevenDaysAgo && updated < yesterdayStart) return "Last 7 days";
    return "Older";
  }, [metaById, id]);

  return (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item flex items-center gap-2 rounded-lg transition-all hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none data-active:bg-muted">
      <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger flex-grow px-3 py-2 text-start">
        {isRenaming ? (
          <ThreadListItemRenameInput
            initialValue={aui.threadListItem().getState().title ?? ""}
            onSubmit={async (title) => {
              // Ask runtime to rename the currently focused thread list item.
              const item = aui.threadListItem();
              const { remoteId } = await item.initialize();
              if (!remoteId) return;

              // Rename the thread via our API. The runtime will pick up the
              // new title on the next refresh. For now we also reload the
              // page to ensure the sidebar reflects the change immediately.
              await fetch(`/api/threads/${remoteId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ title }),
              });

              if (typeof window !== "undefined") {
                window.location.reload();
              }
            }}
            onCancel={() => setIsRenaming(false)}
          />
        ) : (
          <ThreadListItemTitle dayLabel={dayLabel} />
        )}
      </ThreadListItemPrimitive.Trigger>
      <ThreadListItemRename onClick={() => setIsRenaming(true)} />
      <ThreadListItemArchive />
    </ThreadListItemPrimitive.Root>
  );
};

type ThreadListItemTitleProps = {
  dayLabel?: string;
};

const ThreadListItemTitle: FC<ThreadListItemTitleProps> = ({ dayLabel }) => {
  return (
    <div className="flex flex-col">
      <span className="aui-thread-list-item-title text-sm">
        <ThreadListItemPrimitive.Title fallback="Chat" />
      </span>
      {dayLabel && (
        <span className="aui-thread-list-item-day-label text-[10px] text-muted-foreground">
          {dayLabel}
        </span>
      )}
    </div>
  );
};

type ThreadListItemRenameInputProps = {
  initialValue?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onCancel: () => void;
};

const ThreadListItemRenameInput: FC<ThreadListItemRenameInputProps> = ({
  initialValue,
  onSubmit,
  onCancel,
}) => {
  // Use the current title as initial value when opening rename.
  const [internal, setInternal] = useState<string>(initialValue ?? "");

  const handleBlur = () => {
    const trimmed = internal.trim();
    if (!trimmed) {
      onCancel();
      return;
    }
    void onSubmit(trimmed);
    onCancel();
  };

  return (
    <Input
      autoFocus
      className="aui-thread-list-item-rename-input h-7 bg-background text-xs"
      value={internal}
      onChange={(e) => setInternal(e.target.value)}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
};

type ThreadListItemRenameProps = {
  onClick: () => void;
};

const ThreadListItemRename: FC<ThreadListItemRenameProps> = ({ onClick }) => {
  return (
    <TooltipIconButton
      className="aui-thread-list-item-rename size-4 p-0 text-foreground hover:text-primary"
      variant="ghost"
      tooltip="Rename chat"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <PencilIcon />
    </TooltipIconButton>
  );
};

const ThreadListItemArchive: FC = () => {
  return (
    <ThreadListItemPrimitive.Archive asChild>
      <TooltipIconButton
        className="aui-thread-list-item-archive mr-3 ml-auto size-4 p-0 text-foreground hover:text-primary"
        variant="ghost"
        tooltip="Archieve chat"
      >
        <ArchiveIcon />
      </TooltipIconButton>
    </ThreadListItemPrimitive.Archive>
  );
};
