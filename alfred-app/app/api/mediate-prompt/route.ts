import { NextResponse } from "next/server";
import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";

import { fetch_knowledge_store } from "@/lib/tools/tool_fetch_knowledge_store";
import { MEDIATE_PROMPT_SYSTEM } from "@/lib/prompts/mediate-prompt";

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
    model: openai.chat(process.env.OPENAI_CHAT_MODEL || "gpt-4.1-mini"),
    provider: "openai" as const,
  };
}

const { model, provider } = getChatModel();

type MediatePromptRequestBody = {
  prompt?: string;
};

export async function POST(req: Request) {
  let body: MediatePromptRequestBody | null = null;

  try {
    body = (await req.json()) as MediatePromptRequestBody;
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
    // 1) Use the Neo4j tool to fetch relevant schema / knowledge-store context
    const neo4jTool = fetch_knowledge_store();
    if (!neo4jTool || !neo4jTool.execute) {
      throw new Error("Failed to initialize Neo4j tool");
    }

    const neo4jResult = await neo4jTool.execute(
      {
        query: prompt,
      },
      undefined as any,
    );

    // 2) Ask the LLM to rewrite the user's prompt using the retrieved context.
    //    The model should respond with a single improved prompt string.
    const system = MEDIATE_PROMPT_SYSTEM;

    const { text } = await generateText({
      model,
      system,
      prompt:
        `Original prompt (from the user):\n` +
        prompt +
        `\n\nNeo4j context (JSON):\n` +
        JSON.stringify(neo4jResult, null, 2),
      providerOptions:
        provider === "azure"
          ? {
              azure: {
                reasoningEffort: "low",
              },
            }
          : undefined,
    });

    const mediatedPrompt = text.trim();

    return NextResponse.json({
      // Keep response shape compatible with existing client code
      enhancedPrompt: mediatedPrompt || prompt,
    });
  } catch (error) {
    console.error("Error mediating prompt:", error);

    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Unknown error mediating prompt",
      },
      { status: 500 },
    );
  }
}
