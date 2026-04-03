import { tool } from "ai";
import { z } from "zod";
import fs from "fs";
import path from "path";

type ViewRange = [number, number]; // [start_line, end_line], 1-based; end_line = -1 means "to end"

type EntryType = "file" | "directory" | "symlink" | "other";

type DirEntryInfo = {
  name: string;
  path: string;
  type: EntryType;
  size?: number; // bytes, for files
  children?: DirEntryInfo[]; // only for directories within the depth limit
  error?: string; // optional per-entry error (e.g. permission denied on a child directory)
};

const MAX_DIRECTORY_DEPTH = 2; // root + 2 levels deep

async function statSafe(targetPath: string): Promise<fs.Stats | null> {
  try {
    return await fs.promises.stat(targetPath);
  } catch {
    return null;
  }
}

async function listDirectory(
  dirPath: string,
  depth: number
): Promise<DirEntryInfo[]> {
  // We include entries at the current depth, but only recurse while depth < MAX_DIRECTORY_DEPTH
  if (depth > MAX_DIRECTORY_DEPTH) {
    return [];
  }

  const dirents = await fs.promises.readdir(dirPath, { withFileTypes: true });

  const entries: DirEntryInfo[] = [];

  for (const dirent of dirents) {
    // Skip hidden files/directories (e.g. .next, .env, .env.local)
    if (dirent.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(dirPath, dirent.name);

    if (dirent.isDirectory()) {
      const entry: DirEntryInfo = {
        name: dirent.name,
        path: fullPath,
        type: "directory",
      };

      if (depth < MAX_DIRECTORY_DEPTH) {
        try {
          entry.children = await listDirectory(fullPath, depth + 1);
        } catch (err) {
          // If we cannot read a child directory (e.g. EPERM), record the
          // error on that entry but continue listing other entries.
          entry.error =
            err instanceof Error
              ? err.message
              : "Unknown error while reading child directory";
        }
      }

      entries.push(entry);
    } else if (dirent.isFile()) {
      const stat = await statSafe(fullPath);
      entries.push({
        name: dirent.name,
        path: fullPath,
        type: "file",
        size: stat?.size,
      });
    } else {
      entries.push({
        name: dirent.name,
        path: fullPath,
        type: dirent.isSymbolicLink() ? "symlink" : "other",
      });
    }
  }

  return entries;
}

const MAX_PREVIEW_CHARS = 16000; // ~16k characters before truncation

async function readFileWithNumberedLines(
  filePath: string,
  viewRange?: ViewRange
) {
  const content = await fs.promises.readFile(filePath, "utf8");
  const lines = content.split(/\r?\n/);

  const totalLines = lines.length;

  // When a view range is provided, honor it exactly (with bounds checks) and
  // do not apply truncation logic.
  if (viewRange) {
    const [rawStart, rawEnd] = viewRange;

    const start = Math.max(1, rawStart);
    const end = rawEnd === -1 ? totalLines : Math.min(totalLines, rawEnd);

    const selected = lines.slice(start - 1, end);

    return {
      total_lines: totalLines,
      start_line: start,
      end_line: end,
      truncated: false,
      lines: selected.map((text, idx) => ({
        line: start + idx,
        content: text,
      })),
    };
  }

  // No explicit range: return the entire file, but if it exceeds ~16,000
  // characters, truncate from the middle while preserving the beginning and
  // end of the file.
  if (content.length <= MAX_PREVIEW_CHARS) {
    return {
      total_lines: totalLines,
      start_line: 1,
      end_line: totalLines,
      truncated: false,
      lines: lines.map((text, idx) => ({
        line: idx + 1,
        content: text,
      })),
    };
  }

  const half = Math.floor(MAX_PREVIEW_CHARS / 2);

  // Compute prefix range by accumulating characters from the start
  let prefixEndIndex = 0;
  let prefixChars = 0;
  while (
    prefixEndIndex < lines.length &&
    prefixChars + lines[prefixEndIndex].length + 1 <= half
  ) {
    prefixChars += lines[prefixEndIndex].length + 1; // +1 for newline
    prefixEndIndex++;
  }

  // Compute suffix range by accumulating characters from the end
  let suffixStartIndex = lines.length;
  let suffixChars = 0;
  while (
    suffixStartIndex > prefixEndIndex &&
    suffixChars + lines[suffixStartIndex - 1].length + 1 <= half
  ) {
    suffixChars += lines[suffixStartIndex - 1].length + 1;
    suffixStartIndex--;
  }

  const selectedLines: { line: number; content: string }[] = [];

  // Prefix lines: 1 .. prefixEndIndex
  for (let i = 0; i < prefixEndIndex; i++) {
    selectedLines.push({ line: i + 1, content: lines[i] });
  }

  // Suffix lines: suffixStartIndex+1 .. totalLines
  for (let i = suffixStartIndex; i < lines.length; i++) {
    selectedLines.push({ line: i + 1, content: lines[i] });
  }

  return {
    total_lines: totalLines,
    start_line: 1,
    end_line: totalLines,
    truncated: true,
    omitted_middle:
      prefixEndIndex < suffixStartIndex
        ? {
            from_line: prefixEndIndex + 1,
            to_line: suffixStartIndex,
          }
        : null,
    lines: selectedLines,
  };
}

export const tool_fs_view = () =>
  tool({
    description:
      "Inspect the filesystem for the assistant. If the input path is a directory, list its contents up to 2 levels deep with file sizes (excluding hidden entries). If the input is a file path, return the file contents with numbered lines. Optionally, provide a [start_line, end_line] view_range (1-based, end=-1 for end of file) to return only a specific slice. When no view_range is given for a large file, the response is truncated from the middle, showing the beginning and end (~16,000 characters total).",
    inputSchema: z.object({
      path: z
        .string()
        .describe(
          "Path to a file or directory. Prefer an absolute path (e.g. '/mnt/skills' or '/mnt/skills/public/docx/SKILL.md'), but '.' and other relative paths are also allowed and will be resolved against the current working directory."
        ),
      description: z
        .string()
        .describe(
          "Brief explanation of why you are viewing this path, e.g. 'Inspecting a skill definition' or 'Debugging configuration'."
        ),
      view_range: z
        .object({
          start_line: z
            .number()
            .int()
            .min(1)
            .describe("1-based inclusive start line number (must be >= 1)."),
          end_line: z
            .number()
            .int()
            .describe(
              "1-based inclusive end line number, or -1 to read to the end of the file. If not -1, it must be >= start_line."
            ),
        })
        .refine(
          ({ start_line, end_line }) =>
            start_line >= 1 && (end_line === -1 || end_line >= start_line),
          {
            message:
              "view_range must have start_line >= 1 and end_line either -1 (to end of file) or >= start_line.",
          }
        )
        .optional()
        .describe(
          "Optional range object { start_line, end_line } to view only a specific range of lines in a text file. Lines are 1-based; use -1 as end_line to read to the end. Ignored for directories."
        ),
    }),
    execute: async ({ path: targetPath, description, view_range }) => {
      const normalizedPath = targetPath.trim();

      // Support both "mnt/skills/..." and "/mnt/skills/..." style inputs by
      // normalizing a leading slash on the "mnt" prefix. This makes
      // "/mnt/skills/..." behave the same as "mnt/skills/..." when resolving
      // against the current working directory (useful in local dev where
      // there is no actual "/mnt" mount point).
      const mntPrefix = "/mnt/";
      const effectivePath = normalizedPath.startsWith(mntPrefix)
        ? normalizedPath.slice(1) // drop the leading "/" so it resolves to "mnt/..."
        : normalizedPath;

      const resolvedPath = path.isAbsolute(effectivePath)
        ? effectivePath
        : path.resolve(effectivePath);

      const stat = await statSafe(resolvedPath);
      if (!stat) {
        return {
          kind: "error" as const,
          message: `Path not found or not accessible: ${resolvedPath}`,
        };
      }

      if (stat.isDirectory()) {
        const entries = await listDirectory(resolvedPath, 0);
        return {
          kind: "directory" as const,
          path: resolvedPath,
          description,
          max_depth: MAX_DIRECTORY_DEPTH,
          entries,
        };
      }

      if (stat.isFile()) {
        const viewTuple: ViewRange | undefined = view_range
          ? [view_range.start_line, view_range.end_line]
          : undefined;

        const fileView = await readFileWithNumberedLines(
          resolvedPath,
          viewTuple
        );
        return {
          kind: "file" as const,
          path: resolvedPath,
          description,
          size: stat.size,
          ...fileView,
        };
      }

      return {
        kind: "other" as const,
        path: resolvedPath,
        description,
        message: "Path is neither a regular file nor a directory (e.g. device, socket).",
      };
    },
  });
