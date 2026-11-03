"use client";

import { useState } from "react";
import { ModeToggle } from "@/components/shell/mode-toggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function Showcase() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  return (
    <TooltipProvider>
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-6 py-10">
        <header className="flex items-center justify-between gap-4">
          <div>
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>shadcn showcase</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              shadcn, from the old ASKK setup
            </h1>
            <p className="mt-2 text-muted-foreground">
              Base-nova style, JavaScript, neutral theme — the same 14 UI
              primitives main had, plus theme toggle.
            </p>
          </div>
          <ModeToggle />
        </header>

        <Separator />

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Buttons, badges, avatar</h2>
          <div className="flex flex-wrap items-center gap-2">
            <Button>Default</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Badge>Badge</Badge>
            <Badge variant="secondary">Secondary</Badge>
            <Avatar>
              <AvatarFallback>AK</AvatarFallback>
            </Avatar>
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Inputs</h2>
          <Input placeholder="Type something…" />
          <Textarea placeholder="A longer note…" />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Dialog, sheet, menu, tooltip</h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setDialogOpen(true)}>
              Open dialog
            </Button>
            <Button variant="outline" onClick={() => setSheetOpen(true)}>
              Open sheet
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" />}>
                Menu
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuLabel>Actions</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem>New desk</DropdownMenuItem>
                <DropdownMenuItem>Settings</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Tooltip>
              <TooltipTrigger render={<Button variant="outline" />}>
                Hover me
              </TooltipTrigger>
              <TooltipContent>Tooltip works</TooltipContent>
            </Tooltip>
          </div>
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogContent>
              <DialogTitle>Dialog</DialogTitle>
              <DialogDescription>
                This is the dialog primitive from main, controlled with open /
                onOpenChange.
              </DialogDescription>
            </DialogContent>
          </Dialog>
          <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <SheetContent side="right">
              <SheetHeader>
                <SheetTitle>Sheet</SheetTitle>
                <SheetDescription>
                  A side panel, same primitive main used for settings.
                </SheetDescription>
              </SheetHeader>
            </SheetContent>
          </Sheet>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Collapsible and resizable</h2>
          <Collapsible>
            <CollapsibleTrigger render={<Button variant="outline" />}>
              Show more
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 text-muted-foreground">
              Collapsible content, hidden until opened.
            </CollapsibleContent>
          </Collapsible>
          <ResizablePanelGroup
            orientation="horizontal"
            className="h-32 rounded-lg border"
          >
            <ResizablePanel defaultSize={50}>
              <div className="flex h-full items-center justify-center">
                Left pane
              </div>
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={50}>
              <div className="flex h-full items-center justify-center">
                Right pane — drag the handle
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
          <p className="text-sm text-muted-foreground">
            Sidebar, the 14th primitive, is in the tree too — it needs a
            SidebarProvider, so it is not demoed on this page yet.
          </p>
        </section>
      </main>
    </TooltipProvider>
  );
}
