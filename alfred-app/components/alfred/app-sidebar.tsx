"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

type AppSidebarProps = React.ComponentProps<typeof Sidebar> & {
  /**
   * Optional content rendered below the primary navigation menu.
   * For example, the Alfred chat thread list.
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
        <SidebarMenu className="mb-3">
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/alfred"}>
              <Link href="/alfred">
                <span>Alfred</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/graph"}>
              <Link href="/graph">
                <span>Knowledge Store</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/skills"}>
              <Link href="/skills">
                <span>Skills</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={pathname === "/settings"}>
              <Link href="/settings">
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>

        {children}
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
