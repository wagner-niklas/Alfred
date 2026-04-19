"use client";

import { Thread } from "@/components/alfred/thread";
import { SidebarTrigger } from "@/components/ui/sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

export default function Home() {
  return (
    <>
      <header className="flex h-16 shrink-0 items-center gap-2 px-4">
        <SidebarTrigger />
        {/*<Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem className="hidden md:block">Home</BreadcrumbItem>
            <BreadcrumbSeparator className="hidden md:block" />
            <BreadcrumbItem>
              <BreadcrumbPage>Alfred</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>*/}
      </header>
      <main className="flex-1 overflow-hidden">
        <Thread />
      </main>
    </>
  );
}
