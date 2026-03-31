import {
  streamText,
  UIMessage,
  convertToModelMessages,
  stepCountIs,
} from "ai";
import fs from "fs";
import path from "path";
import { getTools } from "@/lib/tools/index";
import { createAzureClient } from "@/lib/ai/azure";
import { createOpenAIClient } from "@/lib/ai/openai";
import { getOrCreateUserId } from "@/lib/user";
import { getUserSettings } from "@/lib/db";

const maxSteps = 25;

type StreamTextArgs = Parameters<typeof streamText>[0];
type ChatLanguageModel = StreamTextArgs["model"];
type ProviderOptions = StreamTextArgs["providerOptions"];

type SkillMetadata = {
  name: string;
  description: string;
  path: string;
};

async function loadSkillsSummary(): Promise<string> {
  const skillsRoot = path.join(process.cwd(), "mnt/skills");

  let dirEntries: fs.Dirent[];
  try {
    dirEntries = await fs.promises.readdir(skillsRoot, {
      withFileTypes: true,
    });
  } catch {
    // If the skills directory is missing or unreadable, silently skip adding
    // the skills section to keep the chat route resilient.
    return "";
  }

  const skills: SkillMetadata[] = [];

  for (const entry of dirEntries) {
    if (!entry.isDirectory()) continue;

    try {
      const skillDir = path.join(skillsRoot, entry.name);
      const skillFile = path.join(skillDir, "SKILL.md");

      const content = await fs.promises.readFile(skillFile, "utf8");

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
  const { userId, setCookieHeader } = getOrCreateUserId(req);

  const { messages }: { messages: UIMessage[] } = await req.json();

  if (!messages || messages.length === 0) {
    throw new Error("No message found");
  }

  const lastMessages = messages.slice(-5);

  let basePrompt = (
    await fs.promises.readFile(
      path.join(process.cwd(), "lib/prompts/assistant-prompt.md"),
      "utf-8",
    )
  ).replace("{{CURRENT_DATE}}", new Date().toISOString().split("T")[0]);

  const skillsSummary = await loadSkillsSummary();

  // Inject available skills summary and user-specific additional instructions
  // from settings into the base system prompt. Missing values degrade
  // gracefully to keep the chat route robust.
  const userSettings = getUserSettings(userId);
  const additionalInstructions = userSettings?.additionalInstructions ?? null;

  basePrompt = basePrompt.replace(
    "{{AVAILABLE_SKILLS}}",
    skillsSummary || "",
  );

  const ASSISTANT_PROMPT = basePrompt.replace(
    "{{ADDITIONAL_INSTRUCTIONS}}",
    additionalInstructions?.trim() || "(none)",
  );

  // Resolve model configuration strictly from per-user settings stored in
  // the database. If no model settings exist for this user, we fail fast and
  // instruct the caller to configure them via the Settings page.
  const model = userSettings?.model;

  if (!model) {
    throw new Error(
      "Model settings are missing. Configure them in /settings before using the chat.",
    );
  }
  
  // Choose the concrete model implementation based on the configured
  // provider. Azure OpenAI uses the Azure client, while OpenAI-compatible
  // endpoints (including proxies) use the OpenAI client with a custom
  // base URL.
  let chatModel: ChatLanguageModel | undefined;
  let providerOptions: ProviderOptions | undefined;

  switch (model.provider) {
    case "openai-compatible": {
      const openai = createOpenAIClient({
        apiKey: model.apiKey,
        baseURL: model.baseURL,
        deployment: model.deployment,
      });

      chatModel = openai.chat;
      providerOptions = undefined;
      break;
    }
    case "azure-openai":
    default: {
      const azure = createAzureClient({
        apiKey: model.apiKey,
        apiVersion: model.apiVersion,
        baseURL: model.baseURL,
        deployment: model.deployment,
      });

      chatModel = azure.chat;
      providerOptions = {
        azure: {
          reasoningEffort: "low",
        },
      };
      break;
    }
  }

  if (!chatModel) {
    throw new Error(`Unsupported model provider: ${model.provider}`);
  }

  const result = streamText({
    model: chatModel,
    system: ASSISTANT_PROMPT,
    messages: await convertToModelMessages(lastMessages),
    stopWhen: stepCountIs(maxSteps),
    tools: getTools(req),
    providerOptions,
  });

  const response = result.toUIMessageStreamResponse();

  if (setCookieHeader) {
    response.headers.set("Set-Cookie", setCookieHeader);
  }

  return response;
}