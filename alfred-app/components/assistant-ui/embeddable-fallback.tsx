"use client";

import * as React from "react";
import { ExternalLink, Copy } from "lucide-react";

type Props = {
  url: string;
  title?: string;
};

export default function EmbeddableFallback({ url, title }: Props) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      // ignore
    }
  }

  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-4 rounded-md border bg-muted p-6 text-center">
      <div className="text-sm font-semibold">
        Embedding blocked — preview not available
      </div>
      <div className="max-w-[60ch] text-xs text-muted-foreground">
        The external site prevents being shown inside an iframe for security
        reasons (clickjacking protection). You can open the dashboard in a new
        tab or copy the URL to view it safely.
      </div>

      <div className="flex gap-2">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center rounded-md bg-primary px-3 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <ExternalLink className="mr-2 size-4" />
          Open in new tab
        </a>

        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center rounded-md border px-3 py-2 text-sm text-muted-foreground hover:bg-muted"
        >
          <Copy className="mr-2 size-4" />
          {copied ? "Copied" : "Copy URL"}
        </button>
      </div>
    </div>
  );
}
