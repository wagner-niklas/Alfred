import type {
  ChatModelSettings,
  DatabricksSettings,
  EmbeddingSettings,
  GraphSettings,
  ModelSettings,
} from "@/lib/db";

// Shared settings payload/response types used by both the API layer and
// client-side settings UI. Keeping these in a dedicated module avoids
// importing route handlers into client components while ensuring type
// consistency across the stack.

export type SettingsPayload = {
  model?: ModelSettings | null;
  models?: ChatModelSettings[] | null;
  embedding?: EmbeddingSettings | null;
  graph?: GraphSettings | null;
  databricks?: DatabricksSettings | null;
  additionalInstructions?: string | null;
};

export type SettingsResponse = SettingsPayload & {
  userId: string;
};
