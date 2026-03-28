import { NextResponse } from "next/server";
import { generateText } from "ai";

import { tool_neo4j_query } from "@/lib/tools/tool_neo4j_query";
import { ENHANCE_PROMPT_SYSTEM } from "@/lib/prompts/enhance-prompt";
import { getDefaultChatModel } from "@/lib/azure";

type EnhancePromptRequestBody = {
  prompt?: string;
};

export async function POST(req: Request) {
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
    // 1) Use the Neo4j tool to fetch relevant schema / knowledge-store context
    const neo4jTool = tool_neo4j_query();
    // We call the tool directly with its input payload; ToolCallOptions are
    // only needed when the SDK invokes tools on behalf of a model.
    const neo4jResult = await neo4jTool.execute(
      {
        query: prompt,
      },
      undefined as any,
    );

    // 2) Ask the LLM to rewrite the user's prompt using the retrieved context.
    //    The model should respond with a single improved prompt string.
    const system = ENHANCE_PROMPT_SYSTEM;

    const { text } = await generateText({
      model: getDefaultChatModel(),
      system,
      prompt:
        `Original prompt (from the user):\n` +
        prompt +
        `\n\nNeo4j context (JSON):\n` +
        JSON.stringify(neo4jResult, null, 2),
    });

    const enhancedPrompt = text.trim();

    // Fallback: if for some reason the model returned an empty string, keep the original.
    return NextResponse.json({
      enhancedPrompt: enhancedPrompt || prompt,
    });
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
