"use client";

import { Suspense, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import type { SettingsResponse } from "@/lib/settings/types";
import { useSettings } from "@/lib/settings/hooks";
import { useSearchParams } from "next/navigation";

// Local helper type used while editing settings client-side.
type DraftSettings = SettingsResponse | null;

// Always operate on a fully-populated SettingsResponse.
function ensureSettingsBase(
  current: DraftSettings,
  loaded: SettingsResponse | null,
): SettingsResponse {
  return {
    userId: current?.userId ?? loaded?.userId ?? "",
    additionalInstructions:
      current?.additionalInstructions ?? loaded?.additionalInstructions ?? null
  };
}

function SettingsPageInner() {
  const searchParams = useSearchParams();
  const userIdFromQuery = searchParams?.get("user_id")?.trim() || null;
  const { data, loading, saving, error, saved, update, save } = useSettings();
  const [deletingAll, setDeletingAll] = useState(false);

  const withBase = (current: DraftSettings): SettingsResponse =>
    ensureSettingsBase(current, data ?? null);



  const handleDeleteAllData = async () => {
    const confirmed = window.confirm(
      "Delete all chats and settings for this browser? This cannot be undone.",
    );

    if (!confirmed) return;

    setDeletingAll(true);

    try {
      const res = await fetch("/api/user/delete", { method: "DELETE" });
      if (!res.ok) {
        throw new Error(`Failed to delete data: ${res.status}`);
      }
    } catch (err) {
      console.error(err);
      alert(
        err instanceof Error
          ? err.message
          : "Failed to delete data for this browser.",
      );
    } finally {
      setDeletingAll(false);
    }
  };

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4" />

      <main className="flex-1 overflow-auto">
          <div className="container mx-auto max-w-4xl py-8 space-y-6">
            <h1 className="text-2xl font-semibold">Settings</h1>

            {loading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            {saved && !error && (
              <p className="text-sm text-green-600">
                Settings saved successfully.
              </p>
            )}

            <div className="grid gap-6 md:grid-cols-1">

              <Card>
                <CardHeader>
                  <CardTitle>Additional instructions</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Advanced. These instructions will be appended to the system
                    prompt for Alfred and apply to all future conversations for
                    this browser.
                  </p>
                  <div className="grid gap-2">
                    <Label htmlFor="additional-instructions">
                      Custom system instructions
                    </Label>
                    <textarea
                      id="additional-instructions"
                      className="min-h-[120px] w-full resize-y rounded-md border bg-background p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                      placeholder="Answer always in German, focus on Data-Engineering-Best-Practices, avoid too much small talk ..."
                      value={data?.additionalInstructions ?? ""}
                      onChange={(event) =>
                        update((current) => {
                          const base = withBase(current);
                          return {
                            ...base,
                            additionalInstructions:
                              event.target.value.trim() === ""
                                ? null
                                : event.target.value,
                          };
                        })
                      }
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="flex flex-col gap-4 border-t pt-6 mt-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-4">
                  <Button onClick={() => void save()} disabled={saving}>
                    {saving ? "Saving…" : "Save settings"}
                  </Button>
                  {!saving && !loading && (
                    <p className="text-xs text-muted-foreground">
                      Settings are stored locally in the Alfred SQLite database for
                      this browser's anonymous user id.
                    </p>
                  )}
                </div>
                {!loading && (
                  <p className="text-[10px] text-muted-foreground/80 font-mono">
                    Current user id: {data?.userId || "(not set)"}
                  </p>
                )}
              </div>

              <div className="flex items-center justify-between rounded-md border border-destructive/20 bg-destructive/5 px-3 py-3">
                <div className="space-y-1">
                  <p className="text-sm font-medium text-destructive">
                    Delete all my data
                  </p>
                  <p className="text-xs text-destructive/80">
                    Permanently remove all chats and settings linked to this browser's
                    anonymous user id. This action cannot be undone.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleDeleteAllData}
                  disabled={deletingAll || saving || loading}
                >
                  {deletingAll ? "Deleting…" : "Delete everything"}
                </Button>
              </div>
            </div>
          </div>
      </main>
    </>
  );
}

export default function SettingsPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh w-full items-center justify-center">
          <p className="text-sm text-muted-foreground">Loading settings…</p>
        </div>
      }
    >
      <SettingsPageInner />
    </Suspense>
  );
}