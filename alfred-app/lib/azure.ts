import { createAzure } from "@ai-sdk/azure";

// Centralised Azure OpenAI client configuration.
//
// This module now exposes *factory* functions that build models given a
// configuration object. This allows us to use per-user settings from the
// database while still supporting environment-variable-based defaults.

export type AzureModelConfig = {
  apiKey: string;
  apiVersion: string;
  baseURL: string;
  deployment: string;
};

export function createAzureClient(config: AzureModelConfig) {
  const azure = createAzure({
    apiKey: config.apiKey,
    apiVersion: config.apiVersion,
    baseURL: config.baseURL,
    useDeploymentBasedUrls: true,
  });

  return {
    chat: azure.chat(config.deployment),
    embedding: (embeddingDeployment?: string) =>
      azure.embedding(
        embeddingDeployment ||
          process.env.AZURE_OPENAI_EMBEDDING_MODEL ||
          process.env.AZURE_OPENAI_EMBEDDING ||
          "deployments/text-embedding-3-large",
      ),
  };
}

// Backwards-compatible default based on environment variables. This is used
// as a fallback when no per-user settings are configured.

export function getDefaultAzureConfig(): AzureModelConfig {
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION;
  const baseURL = process.env.AZURE_OPENAI_BASE_URL;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (!apiKey || !apiVersion || !baseURL || !deployment) {
    throw new Error(
      "Azure model configuration is missing. Please either configure environment variables or per-user settings.",
    );
  }

  return { apiKey, apiVersion, baseURL, deployment };
}

export function getDefaultChatModel() {
  const config = getDefaultAzureConfig();
  return createAzureClient(config).chat;
}

export function getDefaultEmbeddingModel() {
  const config = getDefaultAzureConfig();
  return createAzureClient(config).embedding();
}
