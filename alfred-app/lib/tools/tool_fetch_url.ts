import { tool } from "ai";
import { z } from "zod";
import { Ollama } from "ollama";

export const fetch_url = () =>
  tool({
    description:
      "Use when search results are insufficient but a specific site appears informative and its full page content would likely provide meaningful additional insights.",
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .describe("The URL to fetch."),
    }),
    execute: async ({ url }) => {
      const client = new Ollama({
        host: "https://ollama.com",
        headers: { Authorization: "Bearer " + process.env.OLLAMA_API_KEY },
      });

      const fetchResult = await client.webFetch({ url });

      return fetchResult;
    },
  });
