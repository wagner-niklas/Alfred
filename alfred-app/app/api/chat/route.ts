import { createAzure } from "@ai-sdk/azure";
import {
  streamText,
  UIMessage,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import fs from "fs";
import path from "path";
import { getTools } from "@/lib/tools/index";

export const azure = createAzure({
  apiKey: process.env.AZURE_OPENAI_API_KEY!,
  apiVersion: process.env.AZURE_OPENAI_API_VERSION!,
  baseURL: process.env.AZURE_OPENAI_BASE_URL!,
  useDeploymentBasedUrls: true,
});

const deployment = process.env.AZURE_OPENAI_DEPLOYMENT!;

const maxSteps = 25;

type SkillMetadata = {
  name: string;
  description: string;
  path: string;
};

function loadSkillsSummary(): string {
  const skillsRoot = path.join(process.cwd(), "mnt/skills");

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = fs.readdirSync(skillsRoot, { withFileTypes: true });
  } catch {
    // If the skills directory is missing or unreadable, silently skip adding
    // the skills section to keep the chat route resilient.
    return "";
  }

  const skills: SkillMetadata[] = [];

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;

    const skillDir = path.join(skillsRoot, entry.name);
    const skillFile = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillFile)) continue;

    try {
      const content = fs.readFileSync(skillFile, "utf8");

      // Parse simple frontmatter block at the top of the file. We expect:
      // ---\n
      // name: ...\n
      // description: ...\n
      // license: ...\n
      // ---
      const match = content.match(/^---\s*[\r\n]+([\s\S]*?)\r?\n---/);
      if (!match) continue;

      const frontmatter = match[1];
      let name = "";
      let description = "";

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

      if (!name || !description) continue;

      const relativePath = path
        .relative(process.cwd(), skillFile)
        .replace(/\\/g, "/");

      skills.push({ name, description, path: relativePath });
    } catch {
      // Ignore malformed or unreadable skill files; continue with others.
      continue;
    }
  }

  if (skills.length === 0) return "";

  const lines: string[] = skills.map(
    (skill) =>
      `- **${skill.name}** — ${skill.description} (file: \`${skill.path}\`)`,
  );

  return lines.join("\n");
}

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  if (!messages || messages.length === 0) {
    throw new Error("No message found");
  }

  const lastMessages = messages.slice(-5);

  const basePrompt = fs
    .readFileSync(
      path.join(process.cwd(), "lib/prompts/assistant-prompt.md"),
      "utf-8",
    )
    .replace("{{CURRENT_DATE}}", new Date().toISOString().split("T")[0]);

  const skillsSummary = loadSkillsSummary();
  const ASSISTANT_PROMPT = basePrompt.replace(
    "{{AVAILABLE_SKILLS}}",
    skillsSummary || "",
  );

  const result = streamText({
    model: azure.chat(deployment),
    system: ASSISTANT_PROMPT,
    messages: await convertToModelMessages(lastMessages),
    stopWhen: stepCountIs(maxSteps),
    tools: getTools(),
    providerOptions: {
      azure: {
        reasoningEffort: "low",
      },
    },
  });

  return result.toUIMessageStreamResponse();
}