import { tool_sql_db_query } from "@/lib/tools/tool_sql_db_query";
import { tool_thinking_tool } from "@/lib/tools/tool_thinking_tool";
import { tool_neo4j_query } from "@/lib/tools/tool_neo4j_query";
import { tool_fs_view } from "@/lib/tools/tool_fs_view";
import { tool_ollama_web_search } from "@/lib/tools/tool_ollama_web_search";
import { tool_ollama_web_fetch } from "@/lib/tools/tool_ollama_web_fetch";

export const getTools = () => {
	const baseTools = {
		tool_thinking_tool: tool_thinking_tool(),
    tool_fs_view: tool_fs_view(),
		tool_neo4j_query: tool_neo4j_query(),
		tool_sql_db_query: tool_sql_db_query(),
	};

  if (process.env.OLLAMA_API_KEY) {
    return {
      ...baseTools,
      tool_ollama_web_search: tool_ollama_web_search(),
      tool_ollama_web_fetch: tool_ollama_web_fetch(),
    };
  }

  return baseTools;
};

