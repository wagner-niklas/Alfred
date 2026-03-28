import * as React from "react";
import { AppSidebar } from "@/components/alfred/app-sidebar";
import { ThreadList } from "@/components/alfred/thread-list";

export function ThreadListSidebar(
  props: React.ComponentProps<typeof AppSidebar>,
) {
  return (
    <AppSidebar {...props}>
      <ThreadList />
    </AppSidebar>
  );
}
