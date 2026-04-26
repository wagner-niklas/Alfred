"use client";

// GraphPage
// ----------
//
// Top-level page for the "Knowledge Store" / semantic graph explorer.
//
// This page:
// - Is rendered inside the shared SidebarProvider defined in app/layout.tsx,
//   so it uses the same shell as the Alfred chat view.
// - Renders the shared AppSidebar on the left (see app/layout.tsx).
// - Renders GraphView in the main content area, which is responsible for
//   querying the /api/graph endpoint and visualizing the domain model.
//
// The goal is to keep layout/navigation concerns here, and put all
// graph-specific logic and visualization code into components/graph/*.

import { GraphView } from "@/components/graph/graph-view";

export default function GraphPage() {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4" />
      <div className="flex-1 overflow-hidden">
        <GraphView />
      </div>
    </>
  );
}
