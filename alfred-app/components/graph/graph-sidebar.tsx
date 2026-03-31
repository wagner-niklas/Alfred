"use client";

import * as React from "react";
import { AppSidebar } from "@/components/alfred/app-sidebar";

export function GraphSidebar(
  props: React.ComponentProps<typeof AppSidebar>,
) {
  // Alias around the shared application sidebar so the graph page
  // can keep its own component name while reusing layout + navigation.
  return <AppSidebar {...props} />;
}
