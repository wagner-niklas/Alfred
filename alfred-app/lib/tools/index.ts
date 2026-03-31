import { tool_sql_db_query } from "@/lib/tools/tool_sql_db_query";
import { tool_thinking_tool } from "@/lib/tools/tool_thinking_tool";
import { tool_neo4j_query } from "@/lib/tools/tool_neo4j_query";
import { tool_fs_view } from "@/lib/tools/tool_fs_view";
import { getOrCreateUserId } from "@/lib/user";
import { getUserSettings } from "@/lib/db";

// Tools are now created per request so that we can bind the current user's
// configuration (e.g. Databricks settings) directly into the tool instances.
export const getTools = (req: Request) => {
  const { userId } = getOrCreateUserId(req);
  const userSettings = getUserSettings(userId);

  return {
    tool_thinking_tool: tool_thinking_tool(),
    tool_neo4j_query: tool_neo4j_query(
      userSettings?.graph ?? null,
      userSettings?.embedding ?? null,
    ),
    tool_sql_db_query: tool_sql_db_query(userSettings?.databricks ?? null),
    tool_fs_view: tool_fs_view(),
  };
};