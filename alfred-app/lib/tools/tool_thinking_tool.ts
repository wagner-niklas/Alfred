import { tool } from "ai";
import { z } from "zod";

export const tool_thinking_tool = () =>
  tool({
      name: "tool_thinking_tool",
      description:
        "Tool for strategic reflection on data analysis progress and decision-making.",
      inputSchema: z.object({
        reflection: z
          .string()
          .describe(
            "Your detailed reflection on data analysis progress, findings, gaps, and next steps.",
          ),
      }),
      execute: async (reflection) => {
        const REFLECTION = `Reflection recorded \`${reflection}\``;
        return REFLECTION;
      },
    });