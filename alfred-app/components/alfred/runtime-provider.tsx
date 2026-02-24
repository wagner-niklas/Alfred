"use client";

/**
 * AlfredRuntimeProvider
 * ----------------------
 *
 * This component wires together three layers:
 *
 * 1) Vercel AI SDK chat runtime (useChatRuntime)
 *    - Handles calling the `/api/chat` endpoint and streaming model responses.
 *    - Adds optional adapters such as WebSpeech dictation.
 *
 * 2) Assistant UI LocalRuntime
 *    - Exposes the chat runtime to the Assistant UI components (Thread, Composer, etc.).
 *
 * 3) Remote thread + history persistence
 *    - `remoteThreadListAdapter` talks to our Next.js API routes under `app/api/threads`.
 *      Threads and their titles/archived state are stored in a local SQLite database
 *      via the helpers in `lib/db.ts`.
 *    - `ThreadProvider` installs a `ThreadHistoryAdapter` that persists the full
 *      message history per thread using `/api/threads/[id]/messages`.
 *
 * The net effect is that Assistant UI gets a multi-thread chat UI whose
 * thread list and message history are backed by a replaceable persistence
 * layer, while the actual LLM interactions remain decoupled in `/api/chat`.
 *
 * To adapt this file for another backend, you typically:
 *  - keep the overall structure, but
 *  - point `AssistantChatTransport` at a different chat API, and/or
 *  - reimplement the `/api/threads` endpoints + `lib/db.ts` against your own DB.
 */

import type { ReactNode } from "react";
import { useMemo } from "react";
import {
  AssistantRuntimeProvider,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
  RuntimeAdapterProvider,
  useAui,
  type unstable_RemoteThreadListAdapter as RemoteThreadListAdapter,
  type ThreadHistoryAdapter,
} from "@assistant-ui/react";
import {
  useChatRuntime,
  AssistantChatTransport,
} from "@assistant-ui/react-ai-sdk";
import { WebSpeechDictationAdapter } from "@assistant-ui/react";
import { createAssistantStream } from "assistant-stream";

// Remote thread list adapter: talks to server-side SQLite-backed API routes.
const remoteThreadListAdapter: RemoteThreadListAdapter = {
  async list() {
    const res = await fetch("/api/threads", { cache: "no-store" });
    if (!res.ok) {
      return { threads: [] };
    }

    const threads = (await res.json()) as Array<{
      id: string;
      title: string;
      archived: boolean;
    }>;

    return {
      threads: threads.map((t) => ({
        status: t.archived ? "archived" : "regular",
        remoteId: t.id,
        title: t.title,
      })),
    };
  },

  async initialize(threadId) {
    const res = await fetch("/api/threads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: threadId }),
    });

    if (!res.ok) {
      throw new Error("Failed to initialize thread");
    }

    const thread = (await res.json()) as { id: string };

    // RemoteThreadInitializeResponse requires both remoteId and externalId.
    // We don't use externalId in this project, so we return undefined.
    return { remoteId: thread.id, externalId: undefined };
  },

  async rename(remoteId, newTitle) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTitle }),
    });
  },

  async archive(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: true }),
    });
  },

  async unarchive(remoteId) {
    await fetch(`/api/threads/${remoteId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ archived: false }),
    });
  },

  async delete(remoteId) {
    await fetch(`/api/threads/${remoteId}`, { method: "DELETE" });
  },

  async generateTitle(remoteId, messages) {
    const res = await fetch(`/api/threads/${remoteId}/title`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages }),
    });

    if (!res.ok) {
      // Fallback to a generic title stream
      return createAssistantStream((controller) => {
        controller.appendText("Chat");
        controller.close();
      });
    }

    const { title } = (await res.json()) as { title: string };

    return createAssistantStream((controller) => {
      controller.appendText(title);
      controller.close();
    });
  },

  // Fetch metadata for a single thread. For our current use case, the
  // runtime only needs status/remoteId/title, which we can derive from the
  // existing /api/threads endpoint.
  async fetch(threadId) {
    const res = await fetch("/api/threads", { cache: "no-store" });
    if (!res.ok) {
      throw new Error("Failed to fetch thread metadata");
    }

    const threads = (await res.json()) as Array<{
      id: string;
      title: string;
      archived: boolean;
    }>;

    const thread = threads.find((t) => t.id === threadId);
    if (!thread) {
      // If the thread is missing, return a stub; the runtime mainly relies
      // on list() for the full set.
      return {
        status: "regular" as const,
        remoteId: threadId,
        externalId: undefined,
        title: "Chat",
      };
    }

    return {
      status: thread.archived ? ("archived" as const) : ("regular" as const),
      remoteId: thread.id,
      externalId: undefined,
      title: thread.title,
    };
  },
};

function ThreadProvider({ children }: { children: ReactNode }) {
  const aui = useAui();

  const history = useMemo<ThreadHistoryAdapter>(
    () => ({
      // These base methods are only used by the legacy runtime. Our AI SDK
      // integration goes through `withFormat`, so we keep them as safe
      // no-ops/empty loads.
      async load() {
        return { messages: [] };
      },

      async append() {
        // no-op: AI SDK history goes through withFormat()
      },

      // withFormat is what `useExternalHistory` (used by useAISDKRuntime)
      // actually calls. Here we store the adapter-specific storage format
      // in SQLite via our /api/threads/[id]/messages API routes.
      withFormat(formatAdapter) {
        return {
          async load() {
            // Ensure the thread is initialized so we always have a stable remoteId.
            const { remoteId } = await aui.threadListItem().initialize();
            if (!remoteId) {
              return { headId: null, messages: [] };
            }

            const res = await fetch(`/api/threads/${remoteId}/messages`, {
              cache: "no-store",
            });
            if (!res.ok) {
              return { headId: null, messages: [] };
            }

            const rows = (await res.json()) as Array<{
              id: string;
              role: "user" | "assistant" | "system";
              content: unknown;
              createdAt: string;
            }>;

            // Each row.content is a MessageStorageEntry<TStorageFormat> that
            // was previously stored by append(). We decode it back into the
            // adapter's message format.
            const messages = rows.map((row) => {
              const stored = row.content as any; // MessageStorageEntry<unknown>

              // If the stored entry doesn't match this adapter's format,
              // just skip it to avoid runtime errors.
              if (!stored || stored.format !== formatAdapter.format) {
                return null;
              }

              const decoded = formatAdapter.decode(stored);
              return decoded;
            }).filter((m): m is NonNullable<typeof m> => m !== null);

            return {
              headId: null,
              messages,
            };
          },

          async append(item) {
            // Ensure the thread is initialized and we have a remoteId
            const { remoteId } = await aui.threadListItem().initialize();
            if (!remoteId) return;

            // Build a MessageStorageEntry using the adapter's encode/getId
            const storageEntry = {
              id: formatAdapter.getId(item.message as any),
              parent_id: item.parentId,
              format: formatAdapter.format,
              content: formatAdapter.encode(item as any),
            };

            const messageAny = item.message as any;

            await fetch(`/api/threads/${remoteId}/messages`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: storageEntry.id,
                role: (messageAny.role ?? "assistant") as
                  | "user"
                  | "assistant"
                  | "system",
                content: storageEntry,
                createdAt:
                  (messageAny.createdAt instanceof Date
                    ? messageAny.createdAt
                    : new Date()
                  ).toISOString(),
              }),
            });
          },
        };
      },
    }),
    [aui],
  );

  const adapters = useMemo(() => ({ history }), [history]);

  return (
    <RuntimeAdapterProvider adapters={adapters}>
      {children}
    </RuntimeAdapterProvider>
  );
}

export function AlfredRuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useRemoteThreadListRuntime({
    runtimeHook: () =>
      useChatRuntime({
        transport: new AssistantChatTransport({ api: "/api/chat" }),
        adapters: {
          dictation: new WebSpeechDictationAdapter({
            language: "en-US",
            continuous: true,
            interimResults: true,
          }),
        },
      }),
    adapter: {
      ...remoteThreadListAdapter,
      unstable_Provider: ThreadProvider,
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}
