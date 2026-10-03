import Link from "next/link";

import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { componentItems } from "@/lib/nav";

// Entry dashboard. Placeholder regions are reserved for the landing content.
export default function Home() {
  return (
    <div className="flex flex-1 flex-col gap-6 p-4 md:p-6">
      <section className="flex min-h-48 flex-col justify-end rounded-xl border border-dashed p-6">
        <h1 className="text-2xl font-semibold tracking-tight">ASKK</h1>
        <p className="text-muted-foreground">Landing content goes here.</p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">
          Components
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {componentItems.map(({ title, url, icon: Icon, description }) => (
            <Link key={url} href={url} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
              <Card className="h-full transition-colors hover:bg-muted/50">
                <CardHeader>
                  <Icon className="mb-2 size-5 text-muted-foreground" />
                  <CardTitle>{title}</CardTitle>
                  <CardDescription>{description}</CardDescription>
                </CardHeader>
              </Card>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
