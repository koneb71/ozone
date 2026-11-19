/**
 * Graders for Pick the design: what an agent wrote into files, and whether the directions it sent
 * follow the seeds Ozone dealt. Plain logic, tested in run.test.ts.
 */
import { OzoneDesignProposeInput, type OzoneDesignDirectionInput } from "@t3tools/contracts";
import * as Predicate from "effect/Predicate";
import * as Result from "effect/Result";
import * as Schema from "effect/Schema";

import type { DesignSeed } from "../../apps/server/src/ozone/builds/designDeal.ts";

export const DesignExpect = Schema.Struct({
  /**
   * The agent sends directions, and every ozone_design_propose that Ozone accepted with directions
   * sends one per seed of the deal before it in this sample: the seed's skill in order, a
   * composition, material and motion from the seed's lists with none shared, and real copy.
   */
  followsDeal: Schema.optional(Schema.Boolean),
  /** A case-insensitive regex every sent direction's `copy.brand` matches. */
  brand: Schema.optional(Schema.String),
});
export type DesignExpect = typeof DesignExpect.Type;

type GradedCall = {
  readonly tool: string;
  readonly input: unknown;
  readonly failed?: boolean | undefined;
};

const stringAt = (value: unknown, key: string) =>
  Predicate.hasProperty(value, key) && Predicate.isString(value[key]) ? value[key] : undefined;

/** The lines a Codex apply_patch adds, across every file it adds or updates. */
const patchAdditions = (patch: string) =>
  patch
    .split("\n")
    .flatMap((line) => (line.startsWith("+") ? [line.slice(1)] : []))
    .join("\n");

/**
 * The text each call writes into a file: a Write's content, an Edit's or MultiEdit's new_string,
 * and the lines a Codex apply_patch adds. Shell redirections are left to the shell checks.
 */
const written = ({ tool, input }: GradedCall): ReadonlyArray<string | undefined> => {
  switch (tool) {
    case "Write":
      return [stringAt(input, "content")];
    case "Edit": {
      const patch = stringAt(input, "patch") ?? stringAt(input, "input");
      return [stringAt(input, "new_string"), patch && patchAdditions(patch)];
    }
    case "MultiEdit":
      return Predicate.hasProperty(input, "edits") && Array.isArray(input.edits)
        ? input.edits.map((edit: unknown) => stringAt(edit, "new_string"))
        : [];
    default:
      return [];
  }
};
export const writtenTexts = (calls: ReadonlyArray<GradedCall>) =>
  calls.flatMap((call) => {
    const text = written(call).filter(Boolean).join("\n");
    return text === "" ? [] : [{ call, text }];
  });

/**
 * `filesMust`: each regex matches text a call that succeeded wrote. `filesMustNot`: no regex matches
 * text any call tried to write, so a refused write of a banned import still fails.
 */
export const gradeFiles = (
  expect: {
    readonly filesMust?: ReadonlyArray<string> | undefined;
    readonly filesMustNot?: ReadonlyArray<string> | undefined;
  },
  calls: ReadonlyArray<GradedCall>,
) => {
  const written = writtenTexts(calls);
  const landed = written.filter(({ call }) => call.failed !== true);
  return [
    ...(expect.filesMust ?? []).map((pattern) => ({
      check: `filesMust /${pattern}/`,
      pass: landed.some(({ text }) => new RegExp(pattern).test(text)),
    })),
    ...(expect.filesMustNot ?? []).map((pattern) => ({
      check: `filesMustNot /${pattern}/`,
      pass: !written.some(({ text }) => new RegExp(pattern).test(text)),
    })),
  ];
};

const decodePropose = Schema.decodeUnknownResult(Schema.toCodecJson(OzoneDesignProposeInput));

// Words a first screen would never ship: a greeting, filler, or a slot left to fill.
const PLACEHOLDER_COPY =
  /\bwelcome to\b|lorem ipsum|placeholder|\byour (?:brand|business|company|headline|product|tagline)\b|\[[^\]]*\]|\{[^}]*\}|\bTBD\b/i;

const realCopy = (direction: OzoneDesignDirectionInput) =>
  direction.copy.headline.trim().toLowerCase() !== direction.name.trim().toLowerCase() &&
  [direction.copy.brand, direction.copy.headline, direction.copy.lede, direction.copy.cta].every(
    (text) => !PLACEHOLDER_COPY.test(text),
  );

const allDiffer = (values: ReadonlyArray<string>) => new Set(values).size === values.length;

/** One sent set of directions against the deal before it. */
const followCheck = (
  directions: ReadonlyArray<OzoneDesignDirectionInput>,
  seeds: ReadonlyArray<DesignSeed> | undefined,
) => ({
  skills:
    seeds !== undefined &&
    directions.length === seeds.length &&
    directions.every((direction, index) => direction.skill === seeds[index]?.skill),
  fits:
    seeds !== undefined &&
    directions.every((direction, index) => {
      const fits = seeds[index]?.fits;
      return (
        fits !== undefined &&
        fits.compositions.includes(direction.composition) &&
        fits.materials.includes(direction.material) &&
        fits.motions.includes(direction.motion)
      );
    }),
  distinct: (["skill", "composition", "material", "motion"] as const).every((key) =>
    allDiffer(directions.map((direction) => direction[key])),
  ),
  copy: directions.every(realCopy),
});

/**
 * `deals` are the seeds Ozone dealt in this sample, one entry per ozone_design_propose call without
 * directions that it answered, in call order.
 */
export const gradeDesign = (
  expect: DesignExpect | undefined,
  calls: ReadonlyArray<GradedCall>,
  deals: ReadonlyArray<ReadonlyArray<DesignSeed>> = [],
) => {
  if (expect === undefined) return [];
  const sent: Array<{
    readonly directions: ReadonlyArray<OzoneDesignDirectionInput>;
    readonly seeds: ReadonlyArray<DesignSeed> | undefined;
  }> = [];
  let dealt = 0;
  for (const call of calls) {
    if (call.tool !== "ozone_design_propose" || call.failed === true) continue;
    const input = decodePropose(call.input);
    if (Result.isFailure(input)) continue;
    if (input.success.directions === undefined) dealt++;
    else sent.push({ directions: input.success.directions, seeds: deals[dealt - 1] });
  }
  const checks: Array<{ readonly check: string; readonly pass: boolean }> = [];
  if (expect.followsDeal === true) {
    const followed = sent.map(({ directions, seeds }) => followCheck(directions, seeds));
    checks.push({ check: "design.sent", pass: sent.length > 0 });
    for (const key of ["skills", "fits", "distinct", "copy"] as const)
      checks.push({
        check: `design.${key}`,
        pass: followed.length > 0 && followed.every((check) => check[key]),
      });
  }
  if (expect.brand !== undefined) {
    const brand = new RegExp(expect.brand, "i");
    checks.push({
      check: `design.brand /${expect.brand}/i`,
      pass:
        sent.length > 0 &&
        sent.every(({ directions }) => directions.every(({ copy }) => brand.test(copy.brand))),
    });
  }
  return checks;
};
