import { tool } from "ai";
import { z } from "zod";
import { Ollama } from "ollama";

const MAX_WEB_RESULTS = 3;

export const search_web = () =>
  tool({
    description:
      "Use concise, keyword-based `search_web` queries.",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The search query."),
    }),
    execute: async ({ query }) => {
      const client = new Ollama({
        host: 'https://ollama.com',
        headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
      });

      // The webSearch API is provided by the local Ollama server and returns
      // structured search results. We simply return them to the caller.
      const results = await client.webSearch({
        query,
        maxResults: MAX_WEB_RESULTS,
      });

      return results;
    },
  });
