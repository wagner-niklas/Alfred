import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

const SKILLS_ROOT = path.join(process.cwd(), "mnt/skills");

function isValidSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    slug.trim().length > 0 &&
    !slug.includes("/") &&
    !slug.includes("\\") &&
    !slug.includes("..")
  );
}

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
    const content = fs.readFileSync(skillFile, "utf8");
    const { name, description } = parseFrontmatter(content);

    return NextResponse.json({ slug, name, description, content });
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
