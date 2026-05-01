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
import { HugeiconsIcon } from "@hugeicons/react";
import { SaturnIcon } from "@hugeicons/core-free-icons";

import { ThreadList } from "@/components/alfred/thread-list";
import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
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
  const { state } = useSidebar();
  const isCollapsed = state === "collapsed";

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="aui-sidebar-header mb-2">
        <div className="aui-sidebar-header-content flex h-8 w-full items-center justify-between">
          {isCollapsed ? (
            <SidebarTrigger className="mx-auto" />
          ) : (
            <>
              <Link href="/alfred" className="aui-sidebar-header-title leading-none pl-1">
                <HugeiconsIcon icon={SaturnIcon} className="h-6 w-6 text-primary" />
              </Link>
              <SidebarTrigger />
            </>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent className="aui-sidebar-content px-2">
        {/* 1) Global "New thread" entry at the very top */}
        <SidebarMenu className="mb-3">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/alfred"} tooltip="New thread" className="py-0">
              <ThreadListPrimitive.New asChild>
                <Link href="/alfred">
                  <PlusIcon className={pathname === "/alfred" ? "h-4 w-4 text-primary" : "h-4 w-4 hover:text-primary"} />
                  <span className={pathname === "/alfred" ? "text-primary group-data-[collapsible=icon]:hidden" : "group-data-[collapsible=icon]:hidden"}>New thread</span>
                </Link>
              </ThreadListPrimitive.New>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/skills"} tooltip="Skills" className="py-0">
              <Link href="/skills">
                <SkillsIcon className={pathname === "/skills" ? "h-4 w-4 shrink-0 text-primary" : "h-4 w-4 shrink-0 hover:text-primary"} />
                <span className={pathname === "/skills" ? "text-primary group-data-[collapsible=icon]:hidden" : "group-data-[collapsible=icon]:hidden"}>Skills</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/settings"} tooltip="Settings" className="py-0">
              <Link href="/settings">
                <SettingsIcon className={pathname === "/settings" ? "h-4 w-4 shrink-0 text-primary" : "h-4 w-4 shrink-0 hover:text-primary"} />
                <span className={pathname === "/settings" ? "text-primary group-data-[collapsible=icon]:hidden" : "group-data-[collapsible=icon]:hidden"}>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {/* 3) Search + global Alfred thread history – visible on all pages */}
        {!isCollapsed && <ThreadList />}

        {/* Optional per-page sidebar content below the shared thread list */}
        {!isCollapsed && children}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
