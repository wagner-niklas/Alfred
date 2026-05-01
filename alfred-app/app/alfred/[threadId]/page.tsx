"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { Settings } from "lucide-react";

import { Thread } from "@/components/alfred/thread";
import { SettingsSheet } from "@/components/alfred/settings-sheet";
import { Button } from "@/components/ui/button";

export default function AlfredThreadPage() {
  const params = useParams<{ threadId: string }>();
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <>
      <header className="flex h-16 shrink-0 items-center justify-between gap-2 px-4">
        <div />
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings className="h-5 w-5" />
        </Button>
      </header>
      <main className="flex-1 overflow-hidden">
        {/* The Thread component itself is responsible for binding to the
            currently selected Assistant UI thread. We just reuse it here
            for the dynamic [threadId] route so URL structure is
            /alfred/[threadId] instead of query params. */}
        <Thread />
      </main>
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
