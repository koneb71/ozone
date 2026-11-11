import { createFileRoute } from "@tanstack/react-router";
import { isDatabaseReady } from "@/db";

export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const db = await isDatabaseReady();
        return Response.json(
          { ok: db, db },
          { status: db ? 200 : 503, headers: { "Cache-Control": "no-store" } },
        );
      },
    },
  },
});
