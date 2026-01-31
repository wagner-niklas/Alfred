"use client";

// GraphPage
// ----------
//
// Top-level page for the "Knowledge Store" / semantic graph explorer.
//
// This page:
// - Wraps the layout in the shared SidebarProvider so it uses the same
//   shell as the Alfred chat view.
// - Renders the GraphSidebar on the left (graph-specific filters/controls).
// - Renders GraphView in the main content area, which is responsible for
//   querying the /api/graph endpoint and visualizing the domain model.
//
// The goal is to keep layout/navigation concerns here, and put all
// graph-specific logic and visualization code into components/graph/*.

import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import Link from "next/link";
import { GraphView } from "@/components/graph/graph-view";
import { GraphSidebar } from "@/components/graph/graph-sidebar";

export default function GraphPage() {
  return (
    <SidebarProvider>
      <div className="flex h-dvh w-full pr-0.5">
        <GraphSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem className="hidden md:block">
                  <BreadcrumbLink asChild>
                    <Link href="/alfred">Home</Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator className="hidden md:block" />
                <BreadcrumbItem>
                  <BreadcrumbPage>Knowledge Store</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
          </header>
          <div className="flex-1 overflow-hidden">
            <GraphView />
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
