// Shared settings payload/response types used by both the API layer and
// client-side settings UI. Keeping these in a dedicated module avoids
// importing route handlers into client components while ensuring type
// consistency across the stack.

// In the simplified configuration model, only the per-user prompt lives
// in the database.
export type SettingsPayload = {
  additionalInstructions?: string | null;
};

export type SettingsResponse = SettingsPayload & {
  userId: string;
}
