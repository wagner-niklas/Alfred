import { tool_sql_db_query } from "@/lib/tools/tool_sql_db_query";
import { tool_thinking_tool } from "@/lib/tools/tool_thinking_tool";
import { tool_neo4j_query } from "@/lib/tools/tool_neo4j_query";

export const getTools = () => ({
  tool_thinking_tool: tool_thinking_tool(),
  tool_neo4j_query: tool_neo4j_query(),
  tool_sql_db_query: tool_sql_db_query(),
});