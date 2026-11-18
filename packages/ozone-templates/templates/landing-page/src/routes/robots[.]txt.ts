import { createFileRoute } from "@tanstack/react-router";
import { site } from "@/lib/site";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: ({ request }) => {
        // Behind a proxy the request's own address may be an internal one: site.url wins.
        const origin = site.url === "" ? new URL(request.url).origin : site.url;
        const body = [
          "User-agent: *",
          "Allow: /",
          "Disallow: /api/",
          "",
          `Sitemap: ${new URL("/sitemap.xml", origin).href}`,
          "",
        ].join("\n");
        return new Response(body, { headers: { "Content-Type": "text/plain; charset=utf-8" } });
      },
    },
  },
});
