import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import {
  OZONE_DESIGN_FACES,
  OZONE_DESIGN_KINDS,
  OZONE_DESIGN_TRADES,
  type OzoneDesignKind,
  type OzoneDesignSkill,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";

import { templateFiles } from "../apps/templates.ts";
import {
  contrast,
  deal,
  dealtIds,
  decodeLibrary,
  isDark,
  isViolet,
  LIBRARY_FILES,
  placeGround,
} from "./designDeal.ts";
import { TECH_KINDS } from "./designVocabulary.ts";

// The library as Ozone itself reads it, from the copy every app with pages gets.
const library = Effect.gen(function* () {
  const files = yield* templateFiles("web-app");
  const text = (name: string) =>
    new TextDecoder().decode(files.find((file) => file.path === name)?.bytes);
  return yield* decodeLibrary({
    palettes: text(LIBRARY_FILES.palettes),
    types: text(LIBRARY_FILES.types),
  });
}).pipe(Effect.provide(NodeServices.layer));

const seeded = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

// design-taste-frontend deals from the whole library, as its own start.mjs does.
const SKILL_TAGS: Partial<Record<OzoneDesignSkill, ReadonlyArray<string>>> = {
  "minimalist-ui": ["light-neutral", "earth", "pastel-fields"],
  "high-end-visual-design": ["light-neutral", "earth", "photographic-neutral"],
  "gpt-taste": ["two-tone", "single-field", "photographic-neutral"],
  "industrial-brutalist-ui": ["flat-loud", "two-tone", "light-neutral"],
};
const SKILL_CLASSES: Partial<Record<OzoneDesignSkill, ReadonlyArray<string>>> = {
  "minimalist-ui": ["serif"],
  "high-end-visual-design": ["serif", "geometric", "wide"],
  "gpt-taste": ["geometric", "wide", "neo-grotesk"],
  "industrial-brutalist-ui": ["neo-grotesk", "wide", "slab"],
};

// Whether each list can give its own entry, none shared.
const distinct = (lists: ReadonlyArray<ReadonlyArray<string>>, used = new Set<string>()): boolean =>
  lists.length === 0 ||
  (lists[0] ?? []).some(
    (entry) => !used.has(entry) && distinct(lists.slice(1), new Set(used).add(entry)),
  );

describe("design deal", () => {
  it.effect("pairs only faces every client bundles, and all of them", () =>
    Effect.gen(function* () {
      const { pairings } = yield* library;
      const families = new Set(
        pairings.flatMap((pairing) => [pairing.display.family, pairing.text.family]),
      );
      assert.deepStrictEqual([...families].toSorted(), [...OZONE_DESIGN_FACES].toSorted());
    }),
  );

  it.effect("deals every skill a palette and pairing of its own look on every kind", () =>
    Effect.gen(function* () {
      const lib = yield* library;
      for (const kind of OZONE_DESIGN_KINDS) {
        // The first deal takes the two skills the second avoids, so together they cover all five.
        const first = deal(lib, { kind }, seeded(1));
        const second = deal(lib, { kind, avoid: dealtIds(first) }, seeded(2));
        const skills = [...first, ...second].map((seed) => seed.skill);
        assert.strictEqual(new Set(skills).size, 5, kind);
        for (const seeds of [first, second]) {
          for (const seed of seeds) {
            // The terminal look needs a dark ground.
            if (!isDark(seed.palette.colors.background)) {
              assert.notInclude(seed.fits.materials, "terminal", `${kind} ${seed.skill}`);
            }
            const tags = SKILL_TAGS[seed.skill];
            const classes = SKILL_CLASSES[seed.skill];
            if (tags === undefined || classes === undefined) continue;
            const palette = lib.palettes.find((entry) => entry.id === seed.palette.id);
            const pairing = lib.pairings.find((entry) => entry.id === seed.type.id);
            assert.isTrue(
              palette?.tags.some((tag) => tags.includes(tag)),
              `${kind} ${seed.skill} ${seed.palette.id}`,
            );
            assert.include(classes, pairing?.class, `${kind} ${seed.skill} ${seed.type.id}`);
          }
          for (const part of ["compositions", "materials", "motions"] as const) {
            assert.isTrue(
              distinct(seeds.map((seed) => seed.fits[part])),
              `${kind}: no ${part} for each direction`,
            );
          }
        }
      }
    }),
  );

  it.effect("keeps every dealt look readable, quiet where it must be, and bundled", () =>
    Effect.gen(function* () {
      const lib = yield* library;
      const faces: ReadonlySet<string> = new Set(OZONE_DESIGN_FACES);
      for (let run = 0; run < 200; run++) {
        const kind: OzoneDesignKind = OZONE_DESIGN_KINDS[run % OZONE_DESIGN_KINDS.length] ?? "tech";
        const trade =
          run % 3 === 0 ? undefined : OZONE_DESIGN_TRADES[run % OZONE_DESIGN_TRADES.length];
        const seeds = deal(lib, { kind, trade }, seeded(run));
        const label = `run ${run}, ${kind} ${trade ?? ""}`;
        assert.strictEqual(seeds[0]?.skill, "design-taste-frontend", label);
        assert.strictEqual(new Set(seeds.map((seed) => seed.skill)).size, 3, label);
        assert.strictEqual(new Set(seeds.map((seed) => seed.palette.id)).size, 3, label);
        for (const [slot, seed] of seeds.entries()) {
          const { colors } = seed.palette;
          assert.isFalse(isViolet(colors.accent), label);
          if (!TECH_KINDS.has(kind)) assert.isFalse(isDark(colors.background), label);
          if (kind === "place" && slot === 0) {
            const palette = lib.palettes.find((entry) => entry.id === seed.palette.id);
            assert.isTrue(palette !== undefined && placeGround(palette), label);
          }
          assert.isAtLeast(contrast(colors.muted, colors.background), 4.5, label);
          assert.isAtLeast(contrast(colors.muted, colors.surface), 4.5, label);
          assert.isTrue(faces.has(seed.type.display.family), label);
          assert.isTrue(faces.has(seed.type.body.family), label);
        }
      }
    }),
  );

  it.effect("deals other skills, palettes and pairings again", () =>
    Effect.gen(function* () {
      const lib = yield* library;
      for (const [index, kind] of OZONE_DESIGN_KINDS.entries()) {
        const trade = index % 2 === 0 ? "cafe" : undefined;
        const last = dealtIds(deal(lib, { kind, trade }, seeded(index)));
        const next = dealtIds(deal(lib, { kind, trade, avoid: last }, seeded(index + 100)));
        assert.deepStrictEqual(
          next.skills.slice(1).filter((skill) => last.skills.includes(skill)),
          [],
        );
        assert.deepStrictEqual(
          next.palettes.filter((id) => last.palettes.includes(id)),
          [],
        );
        assert.deepStrictEqual(
          next.pairings.filter((id) => last.pairings.includes(id)),
          [],
        );
      }
    }),
  );
});
