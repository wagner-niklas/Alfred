"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus as PlusIcon,
  PlugZap as DatabaseIcon,
  Blocks as SkillsIcon,
  Settings as SettingsIcon,
} from "lucide-react";

import { ThreadList } from "@/components/alfred/thread-list";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { ThreadListPrimitive } from "@assistant-ui/react";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  /**
   * Optional content rendered below the primary navigation menu and
   * the global Alfred thread list.
   */
  children?: React.ReactNode;
};

export function AppSidebar({ children, ...props }: AppSidebarProps) {
  const pathname = usePathname();

  return (
    <Sidebar {...props}>
      <SidebarHeader className="aui-sidebar-header mb-2">
        <div className="aui-sidebar-header-content items-center justify-between">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton size="lg" asChild>
                <div className="aui-sidebar-header-heading mr-6 gap-0.5 leading-none">
                  <span className="aui-sidebar-header-title text-xl font-mono">
                    Alfred
                  </span>
                </div>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </div>
      </SidebarHeader>

      <SidebarContent className="aui-sidebar-content px-2">
        {/* 1) Global "New thread" entry at the very top */}
        <SidebarMenu className="mb-3">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/alfred"}>
              <ThreadListPrimitive.New asChild>
                <Link href="/alfred">
                  <span className="flex items-center gap-2">
                    <PlusIcon className="h-4 w-4 rounded-md bg-primary/10"/>
                    <span>New thread</span>
                  </span>
                </Link>
              </ThreadListPrimitive.New>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/graph"}>
              <Link href="/graph">
                <span className="flex items-center gap-2">
                  <DatabaseIcon className="h-4 w-4" />
                  <span>Knowledge Store</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/skills"}>
              <Link href="/skills">
                <span className="flex items-center gap-2">
                  <SkillsIcon className="h-4 w-4" />
                  <span>Skills</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/settings"}>
              <Link href="/settings">
                <span className="flex items-center gap-2">
                  <SettingsIcon className="h-4 w-4" />
                  <span>Settings</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* 3) Search + global Alfred thread history – visible on all pages */}
        <ThreadList />

        {/* Optional per-page sidebar content below the shared thread list */}
        {children}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
