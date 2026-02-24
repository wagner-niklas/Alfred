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

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  if (!messages || messages.length === 0) {
    throw new Error("No message found");
  }

  const lastMessages = messages.slice(-5);

  const ASSISTANT_PROMPT = fs
  .readFileSync(path.join(process.cwd(), "lib/prompts/assistant-prompt.md"), "utf-8")
  .replace("{{CURRENT_DATE}}", new Date().toISOString().split("T")[0])

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