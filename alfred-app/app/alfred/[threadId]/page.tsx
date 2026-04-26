"use client";

import { useParams } from "next/navigation";

import { Thread } from "@/components/alfred/thread";

export default function AlfredThreadPage() {
  const params = useParams<{ threadId: string }>();

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4" />
      <main className="flex-1 overflow-hidden">
        {/* The Thread component itself is responsible for binding to the
            currently selected Assistant UI thread. We just reuse it here
            for the dynamic [threadId] route so URL structure is
            /alfred/[threadId] instead of query params. */}
        <Thread />
      </main>
    </>
  );
}
