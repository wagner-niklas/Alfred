"use client";

import { Thread } from "@/components/alfred/thread";

export default function Home() {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4" />
      <main className="flex-1 overflow-hidden">
        <Thread />
      </main>
    </>
  );
}
