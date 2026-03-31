"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import type { SkillDetail, SkillSummary } from "@/lib/skills/types";

/**
 * Page for managing Alfred's skills.
 *
 * Skills are stored as markdown files under `mnt/skills/<slug>/SKILL.md`.
 * This UI lets you:
 *
 * - Browse existing skills (left sidebar)
 * - Edit the markdown content of a selected skill
 * - Create a new skill with sensible defaults
 * - Delete a skill entirely
 */
export default function SkillsPage() {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [listLoading, setListLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setHydrated(true);
    void loadSkills();
    // We intentionally do not include `selectedSlug` in the dependency
    // array here; `loadSkills` accepts an explicit `initialSlug` argument
    // when we want to control the current selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Fetch the list of skills from the server and optionally select an
   * initial skill.
   */
  async function loadSkills(initialSlug?: string) {
    setListLoading(true);
    setError(null);

    try {
      const res = await fetch("/api/skills");
      if (!res.ok) {
        throw new Error(`Failed to load skills: ${res.statusText}`);
      }

      const data = (await res.json()) as SkillSummary[];
      setSkills(data);

      const slugToSelect = initialSlug ?? selectedSlug ?? data[0]?.slug ?? null;
      if (slugToSelect) {
        void selectSkill(slugToSelect);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error loading skills.";
      setError(message);
    } finally {
      setListLoading(false);
    }
  }

  /**
   * Load a specific skill by slug and display its full markdown content.
   */
  async function selectSkill(slug: string) {
    setSelectedSlug(slug);
    setDetail(null);
    setDetailLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(slug)}`);
      if (!res.ok) {
        throw new Error(`Failed to load skill: ${res.statusText}`);
      }

      const data = (await res.json()) as SkillDetail;
      setDetail(data);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error loading skill.";
      setError(message);
    } finally {
      setDetailLoading(false);
    }
  }

  /**
   * Persist the current skill content to the server.
   */
  async function handleSave() {
    if (!detail || !selectedSlug) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(selectedSlug)}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: detail.content }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Failed to save skill: ${res.statusText}`);
      }

      const updated = (await res.json()) as SkillDetail;
      setDetail(updated);

      // Optimistically update the list entry if we have name/description.
      if (updated.name || updated.description) {
        setSkills((prev) =>
          prev.map((s) =>
            s.slug === updated.slug
              ? {
                  slug: updated.slug,
                  name: updated.name ?? s.name,
                  description: updated.description ?? s.description,
                }
              : s,
          ),
        );
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error saving skill.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Delete the currently selected skill and move focus to the next
   * available one, if any.
   */
  async function handleDelete() {
    if (!selectedSlug) return;

    const skill = skills.find((s) => s.slug === selectedSlug);
    const label = skill?.name ?? selectedSlug;

    const confirmed = window.confirm(
      `Remove the skill "${label}"? This will delete it from Alfred's skills.`,
    );

    if (!confirmed) return;

    setDeleting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/skills/${encodeURIComponent(selectedSlug)}`,
        {
          method: "DELETE",
        },
      );

      if (!res.ok && res.status !== 204) {
        const body = await res.text();
        throw new Error(body || `Failed to delete skill: ${res.statusText}`);
      }

      setSkills((prev) => prev.filter((s) => s.slug !== selectedSlug));

      const remaining = skills.filter((s) => s.slug !== selectedSlug);
      const next = remaining[0]?.slug ?? null;

      setSelectedSlug(next);
      setDetail(null);

      if (next) {
        void selectSkill(next);
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error deleting skill.";
      setError(message);
    } finally {
      setDeleting(false);
    }
  }

  /**
   * Create a new skill by prompting for a human-readable name and
   * deriving a filesystem-safe slug from it.
   */
  async function handleNewSkill() {
    const nameInput = window.prompt(
      "Name your new skill (for example: 'Data analysis').",
    );

    if (!nameInput) return;

    const name = nameInput.trim();
    if (!name) return;

    const slug = name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)+/g, "");

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ slug, name }),
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(body || `Failed to create skill: ${res.statusText}`);
      }

      const created = (await res.json()) as SkillDetail & {
        name: string;
        description: string;
      };

      // Update list and select the new skill.
      setSkills((prev) => [
        ...prev,
        {
          slug: created.slug,
          name: created.name,
          description: created.description,
        },
      ]);

      setSelectedSlug(created.slug);
      setDetail({
        slug: created.slug,
        name: created.name,
        description: created.description,
        content: created.content,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Unknown error creating skill.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  const isSaveDisabled = !detail || saving;

  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4 border-b">
        <SidebarTrigger />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">
              <BreadcrumbLink asChild>
                <Link href="/alfred">Home</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Skills</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </header>

      <div className="flex h-[calc(100dvh-4rem)] flex-1 overflow-hidden bg-background">
          <aside className="flex w-80 shrink-0 flex-col border-r bg-background/80">
            <div className="border-b px-4 py-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold tracking-tight">
                    Skills
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Choose a skill and gently steer how Alfred responds.
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleNewSkill}
                  disabled={saving}
                >
                  Add
                </Button>
              </div>
            </div>

            <div className="flex-1 overflow-auto px-2 pb-3 pt-2">
              {listLoading && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  Loading skills...
                </div>
              )}

              {!listLoading && skills.length === 0 && (
                <div className="px-2 py-2 text-xs text-muted-foreground">
                  No skills found yet. Create your first skill to guide Alfred
                  for specific workflows.
                </div>
              )}

              <ul className="space-y-1 text-sm">
                {skills.map((skill) => (
                  <li key={skill.slug}>
                    <button
                      type="button"
                      onClick={() => selectSkill(skill.slug)}
                      className={`w-full rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-accent/60 hover:text-accent-foreground ${selectedSlug === skill.slug ? "bg-accent text-accent-foreground" : ""}`}
                    >
                      <div className="truncate text-[0.8rem] font-medium">
                        {skill.name}
                      </div>
                      <div className="truncate text-[0.72rem] text-muted-foreground">
                        {skill.description}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section className="flex min-w-0 flex-1 flex-col px-10 py-8">
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col space-y-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h1 className="text-base font-semibold tracking-tight">
                    {detail?.name ?? selectedSlug ?? "Skills for Alfred"}
                  </h1>
                  <p className="text-xs text-muted-foreground">
                    {detail?.description
                      ? detail.description
                      : "Describe, in plain language, how Alfred should behave for this skill."}
                  </p>
                </div>
                <div className="flex items-center gap-2 text-[0.7rem] text-muted-foreground">
                  {detailLoading && <span>Loading…</span>}
                  {saving && <span>Saving…</span>}
                  {deleting && <span>Removing…</span>}
                  {selectedSlug && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-[0.7rem] text-destructive hover:bg-destructive/5 hover:text-destructive"
                      onClick={handleDelete}
                      disabled={deleting || saving}
                    >
                      Delete
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="text-xs"
                    onClick={handleSave}
                    disabled={hydrated ? isSaveDisabled : false}
                  >
                    Save
                  </Button>
                </div>
              </div>

              {error && (
                <div className="rounded-md border border-destructive/20 bg-destructive/5 px-3 py-2 text-[0.7rem] text-destructive">
                  {error}
                </div>
              )}

              {!detail && !detailLoading && (
                <div className="flex h-full min-h-[320px] items-center text-sm text-muted-foreground">
                  <p className="max-w-sm">
                    Select a skill on the left or create a new one. Then
                    describe, in natural language, how Alfred should use it in
                    your workflows.
                  </p>
                </div>
              )}
              {detail && (
                <div className="flex min-h-[360px] flex-1 flex-col space-y-2">
                  <textarea
                    className="flex-1 min-h-[360px] w-full resize-none rounded-2xl border border-border/40 bg-background p-4 text-sm leading-relaxed shadow-none outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    value={detail.content}
                    onChange={(e) =>
                      setDetail((prev) =>
                        prev
                          ? {
                              ...prev,
                              content: e.target.value,
                            }
                          : prev,
                      )
                    }
                  />
                  <p className="text-[0.7rem] text-muted-foreground">
                    Write as if you were guiding a colleague. Be concrete about
                    what good answers look like, and what to avoid.
                  </p>
                </div>
              )}
            </div>
          </section>
      </div>
    </>
  );
}
