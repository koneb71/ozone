import { createFileRoute } from "@tanstack/react-router";
import { site } from "@/lib/site";

const escapeXml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: ({ request }) => {
        // Behind a proxy the request's own address may be an internal one: site.url wins.
        const origin = site.url === "" ? new URL(request.url).origin : site.url;
        const urls = site.pages.map(
          (page) => `  <url><loc>${escapeXml(new URL(page, origin).href)}</loc></url>`,
        );
        const body = [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          ...urls,
          "</urlset>",
          "",
        ].join("\n");
        return new Response(body, {
          headers: { "Content-Type": "application/xml; charset=utf-8" },
        });
      },
    },
  },
});
