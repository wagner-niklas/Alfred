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
import {
  SKILLS_ROOT,
  isValidSlug,
  listSkillSummaries,
} from "@/lib/skills/utils";

/**
 * Return a minimal list of skills, suitable for driving the skills
 * sidebar in the UI.
 */
export async function GET() {
  const skills: SkillSummary[] = await listSkillSummaries();
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
