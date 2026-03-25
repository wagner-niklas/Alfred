// /api/skills
// -----------
//
// Collection endpoint for Alfred's file-backed skills.
//
// - GET  /api/skills
//     List all skills discovered under `mnt/skills/`, returning only
//     summary information needed for the UI sidebar (slug, name,
//     description).
//
// - POST /api/skills
//     Create a new skill by writing a `SKILL.md` file into the skills
//     directory. The request body can provide a slug, name, and
//     description; reasonable defaults are applied when omitted.

import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import type { CreateSkillBody, SkillSummary } from "@/lib/skills/types";

const SKILLS_ROOT = path.join(process.cwd(), "mnt/skills");

/**
 * Validate that a slug is safe to use as a directory name under
 * `SKILLS_ROOT`.
 *
 * This is intentionally conservative: it rejects empty strings, path
 * separators, and directory traversal attempts.
 */
function isValidSlug(slug: string): boolean {
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
function parseFrontmatter(content: string): {
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
 * Return a minimal list of skills, suitable for driving the skills
 * sidebar in the UI.
 */
export async function GET() {
  let dirEntries: fs.Dirent[];

  try {
    dirEntries = fs.readdirSync(SKILLS_ROOT, { withFileTypes: true });
  } catch {
    // If the skills directory does not exist yet, treat it as "no skills".
    return NextResponse.json<SkillSummary[]>([]);
  }

  const skills: SkillSummary[] = [];

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;

    const slug = entry.name;
    const skillFile = path.join(SKILLS_ROOT, slug, "SKILL.md");

    if (!fs.existsSync(skillFile)) continue;

    try {
      const content = fs.readFileSync(skillFile, "utf8");
      const { name, description } = parseFrontmatter(content);

      // Skills without basic metadata are ignored; the UI wouldn't be able
      // to present them meaningfully.
      if (!name || !description) continue;

      skills.push({ slug, name, description });
    } catch {
      // Ignore malformed or unreadable skill files; continue with others.
      continue;
    }
  }

  return NextResponse.json(skills);
}

/**
 * Create a new skill with a `SKILL.md` file on disk.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as CreateSkillBody;

  const rawSlug = body.slug?.trim();
  const slug = rawSlug;

  if (!slug || !isValidSlug(slug)) {
    return NextResponse.json(
      { error: "Missing or invalid 'slug' for new skill." },
      { status: 400 },
    );
  }

  const name = (body.name ?? slug).trim();
  const description = (body.description ?? "Describe what this skill is for.").trim();

  const skillDir = path.join(SKILLS_ROOT, slug);
  const skillFile = path.join(skillDir, "SKILL.md");

  if (fs.existsSync(skillFile)) {
    return NextResponse.json(
      { error: `Skill '${slug}' already exists.` },
      { status: 409 },
    );
  }

  const content = `---\nname: ${name}\ndescription: ${description}\nlicense: ...\n---\n\nDescribe how the \`${name}\` skill should behave here.`;

  try {
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(skillFile, content, "utf8");
  } catch (error) {
    console.error("Error creating skill:", error);
    return NextResponse.json(
      { error: "Failed to create skill file." },
      { status: 500 },
    );
  }

  const responseBody = {
    slug,
    name,
    description,
    content,
  } satisfies {
    slug: string;
    name: string;
    description: string;
    content: string;
  };

  return NextResponse.json(responseBody, { status: 201 });
}
