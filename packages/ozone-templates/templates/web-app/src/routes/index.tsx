import { createFileRoute } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Database } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { isDatabaseReady } from "@/db";
import { site } from "@/lib/site";
import { cn } from "@/lib/utils";

const getStatus = createServerFn({ method: "GET" }).handler(async () => ({
  database: await isDatabaseReady(),
}));

export const Route = createFileRoute("/")({
  loader: () => getStatus(),
  component: Home,
});

function Home() {
  const status = Route.useLoaderData();

  return (
    <main className="relative grid min-h-dvh place-items-center px-6 py-16">
      <div aria-hidden="true" className="bg-dot-grid absolute inset-0 -z-10" />
      <div className="flex w-full max-w-2xl flex-col items-center gap-10 text-center">
        <div className="flex flex-col gap-4">
          <h1 className="text-4xl font-semibold tracking-tight text-balance wrap-anywhere sm:text-6xl">
            {site.name}
          </h1>
          <p className="text-lg text-pretty text-muted-foreground">
            Describe what you want and Ozone builds it here.
          </p>
        </div>
        <Card className="w-full max-w-sm py-4">
          <CardContent className="flex items-center gap-3 px-4 text-left">
            <span className="grid size-9 place-items-center rounded-md bg-muted text-muted-foreground">
              <Database aria-hidden="true" className="size-4" />
            </span>
            <div className="flex flex-col gap-1">
              <span className="text-sm leading-none font-medium">Database</span>
              <span className="text-xs leading-none text-muted-foreground">PostgreSQL</span>
            </div>
            <span className="ml-auto flex items-center gap-2 text-sm">
              <span
                aria-hidden="true"
                className={cn(
                  "size-2 rounded-full",
                  status.database ? "bg-success" : "bg-destructive",
                )}
              />
              {status.database ? "Connected" : "Not connected"}
            </span>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
