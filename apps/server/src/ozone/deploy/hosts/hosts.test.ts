import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import { HttpClient, HttpClientResponse } from "effect/http";
import * as Path from "effect/Path";

import type { HostApp, HostSource } from "./HostDriver.ts";
import { makeKoyeb } from "./Koyeb.ts";
import { makeRailway } from "./Railway.ts";
import { makeRender } from "./Render.ts";
import { makeVercel } from "./Vercel.ts";

interface Asked {
  readonly method: string;
  readonly path: string;
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** A host's API that answers from `answer` and remembers what it was asked. */
const fakeApi = (
  answer: (asked: Asked) => { readonly status?: number; readonly json?: unknown },
) => {
  const asked: Array<Asked> = [];
  const http = HttpClient.make((request) =>
    Effect.sync(() => {
      const url = new URL(request.url);
      const entry = {
        method: request.method,
        path: url.pathname,
        body: request.body._tag === "Uint8Array" ? new TextDecoder().decode(request.body.body) : "",
        headers: request.headers,
      };
      asked.push(entry);
      const { json, status = 200 } = answer(entry);
      return HttpClientResponse.fromWeb(
        request,
        new Response(json === undefined ? null : JSON.stringify(json), { status }),
      );
    }),
  );
  return { asked, http };
};

const app: HostApp = {
  name: "Notes",
  slug: "notes-a1b2c3",
  port: 3000,
  healthPath: "/api/health",
  database: { user: "app", database: "app" },
};
const source: HostSource = {
  commitSha: "abc1234",
  remote: { url: "git@github.com:me/notes.git", branch: "main" },
  files: Effect.succeed("/nowhere"),
};
const quiet = () => Effect.void;

it.effect(
  "Railway: a refused token is said in words, and a failed deploy comes back with its log",
  () =>
    Effect.gen(function* () {
      const refusing = fakeApi(() => ({
        json: { data: null, errors: [{ message: "Not Authorized" }] },
      }));
      const error = yield* Effect.flip(
        makeRailway(refusing.http, Effect.succeed("secret")).verify("bad"),
      );
      assert.include(error.message, "refused the token");

      const api = fakeApi(({ body }) => {
        if (body.includes("variableCollectionUpsert")) {
          return { json: { data: { variableCollectionUpsert: true } } };
        }
        if (body.includes("serviceInstanceDeployV2")) {
          return { json: { data: { serviceInstanceDeployV2: "deploy-1" } } };
        }
        if (body.includes("buildLogs")) {
          return { json: { data: { buildLogs: [{ message: "npm ERR! missing script" }] } } };
        }
        if (body.includes("deploymentLogs")) return { json: { data: { deploymentLogs: [] } } };
        return { json: { data: { deployment: { id: "deploy-1", status: "FAILED" } } } };
      });
      const outcome = yield* makeRailway(api.http, Effect.succeed("secret")).release({
        token: "token",
        app,
        source,
        place: {
          ids: { projectId: "p", environmentId: "e", serviceId: "s" },
          url: "https://notes.up.railway.app",
          database: null,
        },
        env: new Map([["PORT", "3000"]]),
        note: quiet,
      });
      assert.deepStrictEqual(outcome, { ok: false, log: "npm ERR! missing script" });
      // Variables are set without Railway deploying on its own, then the asked commit is deployed.
      assert.include(api.asked[0]?.body, '"skipDeploys":true');
      assert.include(api.asked[1]?.body, '"commitSha":"abc1234"');
    }),
);

it.effect("Render: finds the deploy it queued, and waits for that one to go live", () =>
  Effect.gen(function* () {
    let started = false;
    const api = fakeApi(({ method, path }) => {
      if (method === "POST" && path.endsWith("/deploys")) {
        started = true;
        // Queued: Render answers without the deploy.
        return { status: 202 };
      }
      if (path.endsWith("/deploys")) {
        return {
          json: [
            { deploy: started ? { id: "dep-2", status: "live" } : { id: "dep-1", status: "live" } },
          ],
        };
      }
      return { json: [] };
    });
    const outcome = yield* makeRender(api.http).release({
      token: "token",
      app,
      source,
      place: {
        ids: { ownerId: "tea-1", serviceId: "srv-1" },
        url: "https://notes.onrender.com",
        database: null,
      },
      env: new Map([["DATABASE_URL", "postgres://internal/app"]]),
      note: quiet,
    });
    assert.deepStrictEqual(outcome, { ok: true });
    const put = api.asked.find((entry) => entry.method === "PUT");
    assert.strictEqual(put?.body, '[{"key":"DATABASE_URL","value":"postgres://internal/app"}]');
    assert.include(
      api.asked.find((entry) => entry.path.endsWith("/deploys") && entry.method === "POST")?.body,
      "abc1234",
    );
  }),
);

it.effect("Koyeb: reads the database's password from its secret, and connects over TLS", () =>
  Effect.gen(function* () {
    const api = fakeApi(({ method, path }) => {
      if (path === "/v1/services/db-1") {
        return { json: { service: { id: "db-1", latest_deployment_id: "dep-db" } } };
      }
      if (path === "/v1/deployments/dep-db") {
        return {
          json: {
            deployment: {
              id: "dep-db",
              status: "HEALTHY",
              database_info: {
                neon_postgres: {
                  server_host: "ep-1.koyeb.app",
                  server_port: 5432,
                  roles: [{ name: "app", secret_id: "secret-1" }],
                },
              },
            },
          },
        };
      }
      if (method === "POST" && path === "/v1/secrets/secret-1/reveal") {
        return { json: { value: { username: "app", password: "p@ss" } } };
      }
      return { json: { app: { id: "app-1", domains: [{ name: "notes-me.koyeb.app" }] } } };
    });
    const place = yield* makeKoyeb(api.http).ensure({
      token: "token",
      app,
      source,
      ids: { appId: "app-1", databaseId: "db-1", serviceId: "web-1" },
      save: quiet,
      note: quiet,
    });
    assert.strictEqual(place.url, "https://notes-me.koyeb.app");
    assert.strictEqual(
      place.database?.external,
      "postgres://app:p%40ss@ep-1.koyeb.app:5432/app?sslmode=require",
    );
    // Everything was there already, so nothing was created.
    assert.isFalse(
      api.asked.some((entry) => entry.method === "POST" && !entry.path.includes("/reveal")),
    );
  }),
);

it.effect("Vercel: uploads each file under its SHA-1, and reports the address Vercel gave", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = yield* fs.makeTempDirectoryScoped({ prefix: "ozone-vercel-" });
    yield* fs.writeFileString(
      path.join(root, "package.json"),
      '{"dependencies":{"@tanstack/react-start":"1.0.0"}}',
    );
    yield* fs.makeDirectory(path.join(root, "src"));
    yield* fs.writeFileString(path.join(root, "src", "index.ts"), "hello");

    const api = fakeApi(({ method, path: asked }) => {
      if (method === "POST" && asked === "/v13/deployments") {
        return { json: { id: "dpl_1", readyState: "QUEUED" } };
      }
      if (asked === "/v13/deployments/dpl_1") {
        return {
          json: {
            id: "dpl_1",
            readyState: "READY",
            aliasAssigned: true,
            alias: ["notes-me.vercel.app"],
          },
        };
      }
      if (asked.endsWith("/events")) return { json: [] };
      return { json: {} };
    });
    const outcome = yield* makeVercel(api.http, fs, path).release({
      token: "token",
      app: { ...app, database: null },
      source: { ...source, remote: null, files: Effect.succeed(root) },
      place: { ids: { projectId: "prj_1", teamId: "team_1" }, url: "https://x", database: null },
      env: new Map(),
      note: quiet,
    });
    assert.deepStrictEqual(outcome, { ok: true, url: "https://notes-me.vercel.app" });
    const uploads = api.asked.filter((entry) => entry.path === "/v2/files");
    // sha1("hello")
    assert.isTrue(
      uploads.some(
        (entry) => entry.headers["x-vercel-digest"] === "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d",
      ),
    );
    const created = api.asked.find((entry) => entry.path === "/v13/deployments")?.body ?? "";
    assert.include(created, '"file":"src/index.ts"');
    assert.include(created, '"framework":"tanstack-start"');
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
