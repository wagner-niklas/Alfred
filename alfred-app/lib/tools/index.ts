import { view } from "@/lib/tools/tool_view";
import { thinking_tool } from "@/lib/tools/tool_thinking_tool";
import { fetch_knowledge_store } from "@/lib/tools/tool_fetch_knowledge_store";
import { run_sql_query } from "@/lib/tools/tool_run_sql_query";
import { web_search } from "@/lib/tools/tool_web_search";
import { web_fetch } from "@/lib/tools/tool_web_fetch";

export const getTools = () => {
	const baseTools = {
		thinking_tool: thinking_tool(),
    view: view(),
	  fetch_knowledge_store: fetch_knowledge_store(),
		run_sql_query: run_sql_query(),
	};

  if (process.env.OLLAMA_API_KEY) {
    return {
      ...baseTools,
      web_search: web_search(),
      web_fetch: web_fetch(),
    };
  }

  return baseTools;
};

