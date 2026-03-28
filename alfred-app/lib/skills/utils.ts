import fs from "fs";
import path from "path";

import type { SkillDetail, SkillSummary } from "@/lib/skills/types";

// Centralised filesystem utilities for Alfred's skill system.
//
// This module is intentionally server-only: it uses `fs` and `path` and
// must not be imported from client components. Client code should depend
// on the HTTP APIs instead.

export const SKILLS_ROOT = path.join(process.cwd(), "mnt/skills");

/**
 * Validate that a slug is safe to use as a directory name under
 * `SKILLS_ROOT`.
 *
 * This is intentionally conservative: it rejects empty strings, path
 * separators, and directory traversal attempts.
 */
export function isValidSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    slug.trim().length > 0 &&
    !slug.includes("/") &&
    !slug.includes("\\") &&
    !slug.includes("..")
  );
}

/**
 * Extract the `name` and `description` fields from a simple YAML-like
 * frontmatter block at the top of a markdown document.
 */
export function parseFrontmatter(content: string): {
  name?: string;
  description?: string;
} {
  const match = content.match(/^---\s*[\r\n]+([\s\S]*?)\r?\n---/);
  if (!match) return {};

  const frontmatter = match[1];
  let name: string | undefined;
  let description: string | undefined;

  for (const rawLine of frontmatter.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) continue;

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (key === "name") name = value;
    if (key === "description") description = value;
  }

  return { name, description };
}

/**
 * Read a single skill from disk. Throws if the underlying file cannot be
 * read; callers should catch and translate into HTTP responses as needed.
 */
export async function readSkillFromDisk(slug: string): Promise<SkillDetail> {
  if (!isValidSlug(slug)) {
    throw new Error("Invalid skill slug");
  }

  const skillFile = path.join(SKILLS_ROOT, slug, "SKILL.md");
  const content = await fs.promises.readFile(skillFile, "utf8");
  const { name, description } = parseFrontmatter(content);

  return { slug, name, description, content };
}

/**
 * List all skills available under `SKILLS_ROOT`, returning minimal
 * information suitable for UI menus.
 */
export async function listSkillSummaries(): Promise<SkillSummary[]> {
  let dirEntries: fs.Dirent[];

  try {
    dirEntries = await fs.promises.readdir(SKILLS_ROOT, {
      withFileTypes: true,
    });
  } catch {
    // If the skills directory does not exist yet, treat it as "no skills".
    return [];
  }

  const skills: SkillSummary[] = [];

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const skillFile = path.join(SKILLS_ROOT, slug, "SKILL.md");

    try {
      const content = await fs.promises.readFile(skillFile, "utf8");
      const { name, description } = parseFrontmatter(content);

      if (!name || !description) continue;

      skills.push({ slug, name, description });
    } catch {
      // Ignore malformed or unreadable skill files; continue with others.
      continue;
    }
  }

  return skills;
}
