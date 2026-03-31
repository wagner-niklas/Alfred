import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

import {
  SKILLS_ROOT,
  isValidSlug,
  parseFrontmatter,
  readSkillFromDisk,
} from "@/lib/skills/utils";

// NOTE: In newer Next.js App Router versions, `params` is provided as a
// Promise in route handlers, so we need to `await` it before accessing
// `params.skill`. This is why the second argument is typed as
// `{ params: Promise<{ skill: string }> }` and we `await context.params`.

export async function GET(
  _request: Request,
  context: { params: Promise<{ skill: string }> },
) {
  const { skill } = await context.params;
  const slug = skill;

  if (!isValidSlug(slug)) {
    return NextResponse.json(
      { error: "Invalid skill identifier." },
      { status: 400 },
    );
  }

  const skillFile = path.join(SKILLS_ROOT, slug, "SKILL.md");

  if (!fs.existsSync(skillFile)) {
    return NextResponse.json(
      { error: `Skill '${slug}' not found.` },
      { status: 404 },
    );
  }

  try {
    const detail = await readSkillFromDisk(slug);
    return NextResponse.json(detail);
  } catch (error) {
    console.error("Error reading skill:", error);
    return NextResponse.json(
      { error: "Failed to read skill file." },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ skill: string }> },
) {
  const { skill } = await context.params;
  const slug = skill;

  if (!isValidSlug(slug)) {
    return NextResponse.json(
      { error: "Invalid skill identifier." },
      { status: 400 },
    );
  }

  const skillFile = path.join(SKILLS_ROOT, slug, "SKILL.md");

  if (!fs.existsSync(skillFile)) {
    return NextResponse.json(
      { error: `Skill '${slug}' not found.` },
      { status: 404 },
    );
  }

  const body = (await request.json().catch(() => ({}))) as {
    content?: string;
  };

  if (typeof body.content !== "string") {
    return NextResponse.json(
      { error: "Missing 'content' in request body." },
      { status: 400 },
    );
  }

  try {
    fs.writeFileSync(skillFile, body.content, "utf8");
  } catch (error) {
    console.error("Error writing skill:", error);
    return NextResponse.json(
      { error: "Failed to write skill file." },
      { status: 500 },
    );
  }

  const { name, description } = parseFrontmatter(body.content);

  return NextResponse.json({ slug, name, description, content: body.content });
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ skill: string }> },
) {
  const { skill } = await context.params;
  const slug = skill;

  if (!isValidSlug(slug)) {
    return NextResponse.json(
      { error: "Invalid skill identifier." },
      { status: 400 },
    );
  }

  const skillDir = path.join(SKILLS_ROOT, slug);

  if (!fs.existsSync(skillDir)) {
    return NextResponse.json(
      { error: `Skill '${slug}' not found.` },
      { status: 404 },
    );
  }

  try {
    fs.rmSync(skillDir, { recursive: true, force: true });
  } catch (error) {
    console.error("Error deleting skill:", error);
    return NextResponse.json(
      { error: "Failed to delete skill." },
      { status: 500 },
    );
  }

  return new NextResponse(null, { status: 204 });
}
