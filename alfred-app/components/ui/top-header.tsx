"use client";

import * as React from "react";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbList } from "@/components/ui/breadcrumb";

type TopHeaderProps = {
  children?: React.ReactNode;
  includeTrigger?: boolean;
};

export function TopHeader({ children, includeTrigger = true }: TopHeaderProps) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b px-4">
      {includeTrigger ? <SidebarTrigger /> : null}
      <Breadcrumb>
        <BreadcrumbList>{children}</BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

export default TopHeader;
