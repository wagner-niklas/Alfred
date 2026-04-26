import { view } from "@/lib/tools/tool_view";
import { thinking_tool } from "@/lib/tools/tool_thinking_tool";
import { search_database_schema } from "@/lib/tools/tool_search_database_schema";
import { fetch_database_schema_elements } from "@/lib/tools/tool_fetch_database_schema_elements_cypher";
import { db_query } from "@/lib/tools/tool_db_query";
import { search_web } from "@/lib/tools/tool_search_web";
import { fetch_url } from "@/lib/tools/tool_fetch_url";

export const getTools = () => {
	const baseTools = {
		thinking_tool: thinking_tool(),
    view: view(),
	  search_database_schema: search_database_schema(),
		fetch_database_schema_elements: fetch_database_schema_elements(),
		db_query: db_query(),
	};

  if (process.env.OLLAMA_API_KEY) {
    return {
      ...baseTools,
      web_search: search_web(),
      web_fetch: fetch_url(),
    };
  }

  return baseTools;
};

