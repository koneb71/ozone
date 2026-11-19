import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import { OZONE_MANIFEST_FILE_NAME, OzoneAppManifest } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";

import { findDestructiveStatements } from "../data/migrationGuard.ts";
import { PROD_COMPOSE_FILE } from "../deploy/AppDeploy.ts";
import {
  readTemplateBundle,
  SOURCE_TEMPLATES_ROOT,
  TEMPLATE_BUNDLE_FILE,
  templateFiles,
  templateTree,
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
      const agents = yield* read("AGENTS.md");
      assert.include(agents, "<!-- ozone:instructions -->");
      // An app with pages carries its design and SEO skills, with their licences, and every
      // skill AGENTS.md names is there: it is how agents without skill discovery find them.
      const skills = files.filter((entry) => entry.path.startsWith(".agents/skills/"));
      if (id !== "api-service") {
        for (const skill of ["design-taste-frontend", "frontend-design", "seo"]) {
          assert.isTrue(has(`.agents/skills/${skill}/SKILL.md`), `${id}: ${skill}`);
        }
        assert.isTrue(has(".agents/skills/design-taste-frontend/LICENSE"));
        assert.isTrue(has(".agents/skills/frontend-design/LICENSE.txt"));
        // Pick the design deals these, and AGENTS.md keeps them for when DESIGN.md names one.
        for (const skill of [
          "high-end-visual-design",
          "gpt-taste",
          "minimalist-ui",
          "industrial-brutalist-ui",
        ]) {
          for (const file of ["SKILL.md", "agents/openai.yaml", "LICENSE"]) {
            assert.isTrue(has(`.agents/skills/${skill}/${file}`), `${id}: ${skill}/${file}`);
          }
          assert.include(agents, `.agents/skills/${skill}/SKILL.md`);
        }
        // Agents list a skill by its frontmatter name, and DESIGN.md names it by its folder.
        for (const entry of skills) {
          const folder = /^\.agents\/skills\/([^/]+)\/SKILL\.md$/.exec(entry.path)?.[1];
          if (folder === undefined) continue;
          const frontmatter = /^---\n([\s\S]*?)\n---/.exec(new TextDecoder().decode(entry.bytes));
          assert.strictEqual(
            /^name: *(.+)$/m.exec(frontmatter?.[1] ?? "")?.[1],
            folder,
            entry.path,
          );
        }
        // The app's own lint gate must not read them, nor Tailwind scan them.
        assert.include(yield* read("biome.json"), '"!.agents"');
        assert.include(yield* read("src/styles/app.css"), '@source not "../../.agents"');
      } else {
        assert.deepStrictEqual(skills, []);
      }
      for (const [named] of agents.matchAll(/\.agents\/skills\/[\w./-]*[\w-]/g)) {
        assert.isTrue(
          has(named) || files.some((entry) => entry.path.startsWith(`${named}/`)),
          `${id} AGENTS.md names ${named}`,
        );
      }
      assert.isTrue(has("package-lock.json"));
      assert.isTrue(has("dev"));
      // Windows cannot run a script with no extension, so each helper has a twin it can.
      assert.isTrue(has("dev.cmd"));

      const migrations = manifest.migrations?.directory;
      if (migrations !== undefined) {
        // Its migrate command holds back what can lose data, and the report stays out of git.
        assert.isTrue(has("src/db/migration-guard.ts"));
        assert.include(yield* read(".gitignore"), ".ozone/migrations.json");
        // A new app applies these on its first start; none may need a person's decision.
        for (const file of files.filter(
          (entry) => entry.path.startsWith(`${migrations}/`) && entry.path.endsWith(".sql"),
        )) {
          const sql = new TextDecoder().decode(file.bytes);
          assert.deepStrictEqual(findDestructiveStatements(file.path, sql), [], file.path);
        }
      }
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
      const source = yield* templateTree(templatesRoot, template.id);
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
