import { createFileRoute } from "@tanstack/react-router";
import { Gauge, Layers, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { site } from "@/lib/site";

export const Route = createFileRoute("/")({
  component: Home,
});

// Placeholder sections: the site's own content replaces them.
const features = [
  { icon: Gauge, title: "Fast", text: "Pages render on the server and load instantly." },
  { icon: Layers, title: "Clear", text: "One message per section, in plain words." },
  { icon: ShieldCheck, title: "Trusted", text: "Show what people get before they sign up." },
];

function Home() {
  return (
    <main className="flex min-h-dvh flex-col">
      <section className="relative grid place-items-center px-6 py-24 sm:py-32">
        <div aria-hidden="true" className="bg-dot-grid absolute inset-0 -z-10" />
        <div className="flex w-full max-w-3xl flex-col items-center gap-8 text-center">
          <h1 className="text-4xl font-semibold tracking-tight text-balance wrap-anywhere sm:text-6xl">
            {site.name}
          </h1>
          <p className="max-w-xl text-lg text-pretty text-muted-foreground">{site.tagline}</p>
          <a href="#features" className={buttonVariants({ size: "lg" })}>
            See how it works
          </a>
        </div>
      </section>
      <section
        id="features"
        className="mx-auto grid w-full max-w-5xl gap-4 px-6 pb-24 sm:grid-cols-3"
      >
        {features.map((feature) => (
          <Card key={feature.title}>
            <CardContent className="flex flex-col gap-3">
              <feature.icon aria-hidden="true" className="size-5 text-primary" />
              <h2 className="font-medium">{feature.title}</h2>
              <p className="text-sm text-muted-foreground">{feature.text}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      <footer className="mt-auto border-t border-border px-6 py-8 text-center text-sm text-muted-foreground">
        {site.name}
      </footer>
    </main>
  );
}
