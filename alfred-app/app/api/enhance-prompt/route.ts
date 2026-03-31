import { NextResponse } from "next/server";
import { generateText } from "ai";

import { tool_neo4j_query } from "@/lib/tools/tool_neo4j_query";
import { ENHANCE_PROMPT_SYSTEM } from "@/lib/prompts/enhance-prompt";
import { createAzureClient } from "@/lib/ai/azure";
import { createOpenAIClient } from "@/lib/ai/openai";
import { getOrCreateUserId } from "@/lib/user";
import { getUserSettings } from "@/lib/db";

type EnhancePromptRequestBody = {
  prompt?: string;
};

type GenerateTextArgs = Parameters<typeof generateText>[0];
type ChatLanguageModel = GenerateTextArgs["model"];

export async function POST(req: Request) {
  const { userId, setCookieHeader } = getOrCreateUserId(req);

  let body: EnhancePromptRequestBody | null = null;

  try {
    body = (await req.json()) as EnhancePromptRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const prompt = body?.prompt?.trim();

  if (!prompt) {
    return NextResponse.json(
      { error: "Missing or empty 'prompt' field in request body" },
      { status: 400 },
    );
  }

  try {
    const userSettings = getUserSettings(userId);
    const model = userSettings?.model;

    if (!model) {
      return NextResponse.json(
        {
          error:
            "Model settings are missing. Configure them in /settings before using prompt enhancement.",
        },
        { status: 500 },
      );
    }

    // Choose model implementation based on provider.
    let chatModel: ChatLanguageModel | undefined;

    switch (model.provider) {
      case "openai-compatible": {
        const openai = createOpenAIClient({
          apiKey: model.apiKey,
          baseURL: model.baseURL,
          deployment: model.deployment,
        });
        chatModel = openai.chat;
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
        break;
      }
    }

    if (!chatModel) {
      return NextResponse.json(
        { error: `Unsupported model provider: ${model.provider}` },
        { status: 500 },
      );
    }

    // 1) Use the Neo4j tool to fetch relevant schema / knowledge-store
    // context. We pass per-user graph + embedding settings from SQLite
    // when available so this route behaves consistently with the graph API
    // and other tooling. When those settings are missing, the tool falls
    // back to environment variables for backwards compatibility.
    const neo4jTool = tool_neo4j_query(
      userSettings?.graph ?? null,
      userSettings?.embedding ?? null,
    );
    const neo4jResult = await neo4jTool.execute(
      { query: prompt },
      {
        toolCallId: "enhance-prompt:neo4j-query",
        messages: [],
      } satisfies Parameters<typeof neo4jTool.execute>[1],
    );

    // 2) Ask the LLM to rewrite the user's prompt using the retrieved context.
    //    The model should respond with a single improved prompt string.
    const system = ENHANCE_PROMPT_SYSTEM;

    const { text } = await generateText({
      model: chatModel,
      system,
      prompt:
        `Original prompt (from the user):\n` +
        prompt +
        `\n\nNeo4j context (JSON):\n` +
        JSON.stringify(neo4jResult, null, 2),
    });

    const enhancedPrompt = text.trim();

    // Fallback: if for some reason the model returned an empty string, keep the original.
    const response = NextResponse.json({
      enhancedPrompt: enhancedPrompt || prompt,
    });

    if (setCookieHeader) {
      response.headers.set("Set-Cookie", setCookieHeader);
    }

    return response;
  } catch (error) {
    console.error("Error enhancing prompt:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error enhancing prompt",
      },
      { status: 500 },
    );
  }
}
