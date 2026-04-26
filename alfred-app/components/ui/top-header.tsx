"use client";

import * as React from "react";
import { Breadcrumb, BreadcrumbList } from "@/components/ui/breadcrumb";

type TopHeaderProps = {
  children?: React.ReactNode;
};

export function TopHeader({ children }: TopHeaderProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b px-4">
      <Breadcrumb>
        <BreadcrumbList>{children}</BreadcrumbList>
      </Breadcrumb>
    </header>
  );
}

export default TopHeader;
