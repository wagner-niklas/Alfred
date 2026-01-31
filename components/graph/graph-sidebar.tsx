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

export function GraphSidebar(
  props: React.ComponentProps<typeof Sidebar>,
) {
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
            <SidebarMenuButton
              asChild
              isActive={pathname === "/alfred"}
            >
              <Link href="/alfred">
                <span>Alfred</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              asChild
              isActive={pathname === "/graph"}
            >
              <Link href="/graph">
                <span>Knowledge Store</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarContent>

      <SidebarRail />
    </Sidebar>
  );
}
