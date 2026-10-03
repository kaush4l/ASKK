import { Amarante, Geist_Mono } from "next/font/google";
import { AppSidebar } from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { StatusBar } from "@/components/status-bar";
import { ThemeProvider } from "@/components/theme-provider";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// Amarante ships a single weight (400); used for all UI text.
const amarante = Amarante({
  variable: "--font-sans",
  weight: "400",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  preload: false, // only needed once code blocks appear
});

export const metadata = {
  title: "ASKK",
  description: "ASKK — agents that run in your browser",
};

export default function RootLayout({ children }) {
  return (
    <html
      lang="en"
      className={`${amarante.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <SidebarProvider>
              <AppSidebar />
              <SidebarInset className="h-svh overflow-hidden">
                <SiteHeader />
                <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                  {children}
                </div>
                <StatusBar />
              </SidebarInset>
            </SidebarProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
