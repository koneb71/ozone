import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { OZONE_MANIFEST_FILE_NAME, OzoneAppManifest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { PROD_COMPOSE_FILE } from "../deploy/AppDeploy.ts";
import {
  readTemplateBundle,
  readTemplateTree,
  SOURCE_TEMPLATES_ROOT,
  TEMPLATE_BUNDLE_FILE,
  templateFiles,
  TEMPLATES,
  writeTemplateBundle,
} from "./templates.ts";

const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(OzoneAppManifest));

// A template is copied into every app made from it: a missing or mismatched file breaks them all.
it.effect.each(TEMPLATES.map((template) => template.id))(
  "the %s template has everything an app made from it needs",
  (id) =>
    Effect.gen(function* () {
      const files = yield* templateFiles(id);
      const has = (file: string) => files.some((entry) => entry.path === file);
      const read = (file: string) =>
        Effect.succeed(new TextDecoder().decode(files.find((entry) => entry.path === file)?.bytes));

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
      assert.isTrue(has("package-lock.json"));
      assert.isTrue(has("dev"));
    }).pipe(Effect.provide(NodeServices.layer)),
);

// An installed Ozone reads its templates from one file that must hold exactly what the folders do.
// npm and electron-builder drop `.gitignore`, and a lost one would commit the app's `.env`.
it.effect("the bundle a build ships holds every template file, with its mode", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const templatesRoot = path.resolve(
      import.meta.dirname,
      "../../../../..",
      SOURCE_TEMPLATES_ROOT,
    );
    const bundle = path.join(
      yield* fs.makeTempDirectoryScoped({ prefix: "ozone-bundle-" }),
      TEMPLATE_BUNDLE_FILE,
    );
    yield* writeTemplateBundle(templatesRoot, bundle);
    const shipped = yield* readTemplateBundle(bundle);
    for (const template of TEMPLATES) {
      const source = yield* readTemplateTree(path.join(templatesRoot, template.id));
      assert.deepStrictEqual(shipped.get(template.id), source, template.id);
    }
    const webApp = shipped.get("web-app") ?? [];
    const named = (file: string) => webApp.find((entry) => entry.path === file);
    for (const dotfile of [".gitignore", ".dockerignore", ".env.example"]) {
      assert.isDefined(named(dotfile), dotfile);
    }
    assert.strictEqual(named("dev")?.mode, 0o755);
    assert.strictEqual((named("docker/dev-entrypoint.sh")?.mode ?? 0) & 0o111, 0o111);
  }).pipe(Effect.provide(NodeServices.layer)),
);
