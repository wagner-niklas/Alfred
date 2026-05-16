"use client";

import Link from "next/link";
import { Thread } from "@/components/alfred/thread";
import { Button } from "@/components/ui/button";

export default function Home() {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
      </header>
      <main className="flex-1 overflow-hidden">
        <Thread />
      </main>
    </>
  );
}
