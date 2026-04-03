import { tool } from "ai";
import { z } from "zod";
import { Ollama } from "ollama";

export const tool_ollama_web_fetch = () =>
  tool({
    description:
      "Fetches the content of a web page using Ollama's webFetch capability.",
    inputSchema: z.object({
      url: z
        .string()
        .url()
        .describe("The URL of the web page to fetch using Ollama webFetch."),
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
