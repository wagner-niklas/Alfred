import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import {
	streamText,
	UIMessage,
	convertToModelMessages,
	stepCountIs,
} from "ai";
import fs from "fs";
import path from "path";
import { getTools } from "@/lib/tools/index";
import { attachSetCookieHeader, getOrCreateUserId } from "@/lib/user";
import { getUserSettings } from "@/lib/db";
import { listSkillSummaries } from "@/lib/skills/utils";

const chatProvider = process.env.CHAT_PROVIDER || "azure";

function getChatModel() {
  if (chatProvider === "azure") {
    const azure = createAzure({
      apiKey: process.env.AZURE_OPENAI_API_KEY!,
      apiVersion: process.env.AZURE_OPENAI_API_VERSION!,
      baseURL: process.env.AZURE_OPENAI_BASE_URL!,
      useDeploymentBasedUrls: true,
    });

    return {
      model: azure.chat(process.env.AZURE_OPENAI_CHAT_DEPLOYMENT!),
      provider: "azure" as const,
    };
  }

  const openai = createOpenAI({
    apiKey: process.env.OPENAI_API_KEY!,
    baseURL: process.env.OPENAI_BASE_URL,
  });

  return {
    model: openai.chat(
      process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini"
    ),
    provider: "openai" as const,
  };
}

const { model, provider } = getChatModel();

const maxSteps = 25;

async function loadSkillsSummary(): Promise<string> {
  const skills = await listSkillSummaries();
  if (skills.length === 0) return "";

  const lines = skills.map((skill) => {
    const relativePath = path
      .join("mnt/skills", skill.slug, "SKILL.md")
      .replace(/\\/g, "/");

    return `- **${skill.name}** — ${skill.description} (file: \`${relativePath}\`)`;
  });

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

  const skillsSummary = await loadSkillsSummary();

	const { userId, setCookieHeader } = getOrCreateUserId(req);
	const userSettings = getUserSettings(userId);
  const additionalInstructions = userSettings?.additionalInstructions ?? null;

	const ASSISTANT_PROMPT = basePrompt
    .replace(
      "{{ADDITIONAL_INSTRUCTIONS}}",
      additionalInstructions?.trim() || "(none)")
    .replace(
      "{{AVAILABLE_SKILLS}}",
      skillsSummary || "",
  );

	// Convert UI messages from Assistant UI into model messages understood by
	// the `ai` SDK. For Azure chat models, current SDK versions attempt to
	// *download* image URLs (including `data:` URLs) before sending them to
	// the provider, which results in an `AI_DownloadError` like:
	//
	//   URL scheme must be http or https, got data:
	//
	// To avoid hard failures when using Azure as the chat provider, we
	// conservatively strip `data:` image parts from the model messages.
	//
	// This matches the behavior of the default Assistant UI demo when using
	// OpenAI (which natively supports inline image data), while keeping the
	// Alfred app functional with Azure even though the images themselves
	// won't be sent to the model.
	const modelMessages = await convertToModelMessages(lastMessages);

	const sanitizedMessages =
		provider === "azure"
			? modelMessages.map((message: any) => {
					if (!Array.isArray(message.content)) return message;

					const filteredContent = message.content.filter((part: any) => {
						if (!part || typeof part !== "object") return true;
						if (part.type !== "image") return true;
						const url: string | undefined = part.image?.url;
						// Drop inline base64 image data to avoid AI_DownloadError
						// in the Azure adapter.
						if (typeof url === "string" && url.startsWith("data:")) {
							return false;
						}
						return true;
					});

					return {
						...message,
						content: filteredContent,
					};
			  })
			: modelMessages;

	const result = streamText({
		model,
		system: ASSISTANT_PROMPT,
		messages: sanitizedMessages,
		stopWhen: stepCountIs(maxSteps),
		tools: getTools(),
		providerOptions:
			provider === "azure"
				? {
						azure: {
							reasoningEffort: "none",
						},
				  }
				: undefined,
	});

  const response = await result.toUIMessageStreamResponse();
  return attachSetCookieHeader(response, setCookieHeader);
}