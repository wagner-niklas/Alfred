import { createOpenAI } from "@ai-sdk/openai";

// Factory for OpenAI-compatible chat and embedding models.
//
// This is intentionally minimal: it accepts an arbitrary baseURL so it can
// be used with the public OpenAI API as well as self-hosted / proxy
// deployments that implement an OpenAI-compatible HTTP surface.

export type OpenAICompatibleConfig = {
  apiKey: string;
  baseURL: string;
  /**
   * Model name used for chat completions, e.g. "gpt-4.1-mini" or any
   * OpenAI-compatible model identifier.
   */
  deployment: string;
};

export function createOpenAIClient(config: OpenAICompatibleConfig) {
  const openai = createOpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseURL,
  });

  return {
    chat: openai.chat(config.deployment),
    // Embedding factory for OpenAI-compatible endpoints.
    //
    // By default this uses the same deployment name as chat, but callers
    // can pass an explicit embedding model identifier (recommended when
    // the provider distinguishes chat and embedding models).
    embedding: (embeddingDeployment?: string) =>
      openai.embedding(embeddingDeployment ?? config.deployment),
  };
}
