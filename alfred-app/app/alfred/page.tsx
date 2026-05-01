"use client";

import { useState } from "react";
import { Settings } from "lucide-react";
import { Thread } from "@/components/alfred/thread";
import { SettingsSheet } from "@/components/alfred/settings-sheet";
import { Button } from "@/components/ui/button";

export default function Home() {
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
        <Thread />
      </main>
      <SettingsSheet open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
