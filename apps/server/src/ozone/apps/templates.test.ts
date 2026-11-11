import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { OZONE_MANIFEST_FILE_NAME, OzoneAppManifest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { PROD_COMPOSE_FILE } from "../deploy/AppDeploy.ts";
import { templateDirectory, TEMPLATES } from "./templates.ts";

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(OzoneAppManifest));

// A template is copied into every app made from it: a missing or mismatched file breaks them all.
it.effect.each(TEMPLATES.map((template) => template.id))(
  "the %s template has everything an app made from it needs",
  (id) =>
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const root = yield* templateDirectory(id);
      const read = (file: string) => fs.readFileString(path.join(root, file));

      const manifest = yield* decodeManifest(yield* read(OZONE_MANIFEST_FILE_NAME));
      assert.strictEqual(manifest.template, id);
      const compose = yield* read(manifest.runtime.file);
      const prod = yield* read(PROD_COMPOSE_FILE);
      for (const file of [compose, prod]) {
        assert.include(file, "name: __OZONE_APP_SLUG__");
        assert.include(file, manifest.runtime.healthPath);
      }
      for (const service of manifest.data.services) {
        assert.include(compose, `${service.volume}:`);
        assert.include(prod, `${service.volume}:`);
      }
      // The prod file migrates where the app migrates, from a stage that has the tools.
      assert.strictEqual(prod.includes("migrate:"), manifest.migrations !== undefined);
      assert.include(yield* read("AGENTS.md"), "<!-- ozone:instructions -->");
      assert.isTrue(yield* fs.exists(path.join(root, "package-lock.json")));
      assert.isTrue(yield* fs.exists(path.join(root, "dev")));
    }).pipe(Effect.provide(NodeServices.layer)),
);
