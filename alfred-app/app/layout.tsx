import type { Metadata } from "next";
import { ThemeProvider } from "@/components/theme-provider";
import { Starfield } from "@/components/ui/starfield";
import { SidebarProvider, SidebarInset } from "@/components/ui/sidebar";
import { AlfredRuntimeProvider } from "@/components/alfred/runtime-provider";
import { AppSidebar } from "@/components/alfred/app-sidebar";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Alfred",
  description: "An open-source AI assistant for research and structured data",
  icons: {
    icon: [{ url: "/icon.svg" }],
    shortcut: "/icon.svg",
  },
};

// RootLayoutProps definieren
interface RootLayoutProps {
  children: React.ReactNode;
}

export default async function RootLayout({ children }: RootLayoutProps) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable}`}
      suppressHydrationWarning
    >
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <SidebarProvider>
            <Starfield />
            <AlfredRuntimeProvider>
              <div className="relative z-10 flex h-dvh w-full pr-0.5">
                <AppSidebar />
                <SidebarInset className="flex flex-1 flex-col overflow-hidden">
                  {children}
                </SidebarInset>
              </div>
            </AlfredRuntimeProvider>
          </SidebarProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
