import { tool } from "ai";
import { z } from "zod";
import { Ollama } from "ollama";

export const web_fetch = () =>
  tool({
    description:
      "Fetch the contents of a web page at a given URL.",
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
