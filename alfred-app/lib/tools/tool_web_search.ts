import { tool } from "ai";
import { z } from "zod";
import { Ollama } from "ollama";

export const web_search = () =>
  tool({
    description:
      "Search the web",
    inputSchema: z.object({
      query: z
        .string()
        .describe("The search query."),
      max_results: z
        .number()
        .int()
        .min(1)
        .max(10)
        .optional()
        .default(5)
        .describe("Maximum number of search results to return (default 5, max 10)."),
    }),
    execute: async ({ query, max_results }) => {
      const client = new Ollama({
        host: 'https://ollama.com',
        headers: { Authorization: 'Bearer ' + process.env.OLLAMA_API_KEY },
      });

      // The webSearch API is provided by the local Ollama server and returns
      // structured search results. We simply return them to the caller.
      const results = await client.webSearch({
        query,
        maxResults: max_results,
      });

      return results;
    },
  });
