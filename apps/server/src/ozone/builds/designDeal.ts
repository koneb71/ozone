/**
 * Deals each design direction a skill, a palette and a type pairing from the taste library, so the
 * lead starts from tested colours and faces instead of inventing them.
 */
// Ported from taste-skill (MIT, Leonxlnx/taste-skill at f6b7657): scripts/start.mjs and the OKLab
// colour helpers of assets/effects/fx.js.
import {
  OZONE_DESIGN_FACES,
  type OzoneDesignDirection,
  type OzoneDesignFace,
  type OzoneDesignKind,
  type OzoneDesignSkill,
  type OzoneDesignTrade,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { skillFits, TECH_KINDS } from "./designVocabulary.ts";

/** Where an app keeps its skills, and where the taste library sits among them. */
export const APP_SKILLS_PATH = ".agents/skills";
const LIBRARY_PATH = `${APP_SKILLS_PATH}/design-taste-frontend/library`;
export const LIBRARY_FILES = {
  palettes: `${LIBRARY_PATH}/palettes.json`,
  types: `${LIBRARY_PATH}/type.json`,
} as const;

const Hex = Schema.String.check(Schema.isPattern(/^#[0-9a-fA-F]{6}$/));

const Palette = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  tags: Schema.Array(Schema.String),
  trades: Schema.optionalKey(Schema.Array(Schema.String)),
  bg: Hex,
  surface: Hex,
  ink: Hex,
  muted: Hex,
  accent: Hex,
  accentInk: Hex,
  note: Schema.String,
});
type Palette = typeof Palette.Type;

const PlaceGroup = Schema.Literals(["serif", "plain", "soft"]);
type PlaceGroup = typeof PlaceGroup.Type;

const Pairing = Schema.Struct({
  id: Schema.String,
  class: Schema.String,
  kinds: Schema.optionalKey(Schema.Record(Schema.String, Schema.Number)),
  place: Schema.optionalKey(PlaceGroup),
  display: Schema.Struct({ family: Schema.String }),
  text: Schema.Struct({ family: Schema.String }),
});
type Pairing = typeof Pairing.Type;

const decodePalettes = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.NonEmptyArray(Palette)),
);
const decodePairings = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.NonEmptyArray(Pairing)),
);

export const decodeLibrary = (files: { readonly palettes: string; readonly types: string }) =>
  Effect.all({ palettes: decodePalettes(files.palettes), pairings: decodePairings(files.types) });
export type DesignLibrary = Effect.Success<ReturnType<typeof decodeLibrary>>;

type Triple = readonly [number, number, number];

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

const each = (t: Triple, f: (v: number) => number): Triple => [f(t[0]), f(t[1]), f(t[2])];

const rgb = (hex: string): Triple => {
  const n = Number.parseInt(hex.slice(1, 7), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const toHex = (color: Triple) =>
  `#${color
    .map((v) =>
      Math.round(clamp(v, 0, 1) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;

const lab = (hex: string): Triple => {
  const [r, g, b] = each(rgb(hex), toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
};

const labToLinear = ([L, a, b]: Triple): Triple => {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
};
const inGamut = (linear: Triple) => linear.every((v) => v >= -1e-4 && v <= 1 + 1e-4);

// Keeps lightness and hue, and reduces chroma until the colour fits sRGB.
const fromLab = (color: Triple): string => {
  let linear = labToLinear(color);
  if (!inGamut(linear)) {
    const [L, a, b] = [clamp(color[0], 0, 1), color[1], color[2]];
    let low = 0;
    let high = 1;
    for (let step = 0; step < 18; step++) {
      const k = (low + high) / 2;
      if (inGamut(labToLinear([L, a * k, b * k]))) low = k;
      else high = k;
    }
    linear = labToLinear([L, a * low, b * low]);
  }
  return toHex(each(linear, (v) => toGamma(clamp(v, 0, 1))));
};

const lch = (hex: string): Triple => {
  const [L, a, b] = lab(hex);
  return [L, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
};

const luminance = (hex: string) => {
  const [r, g, b] = each(rgb(hex), toLinear);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** The WCAG contrast ratio. */
export const contrast = (a: string, b: string) => {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** A perceptual mix in OKLab: 0 gives `a`, 1 gives `b`. */
const mix = (a: string, b: string, t: number) => {
  const A = lab(a);
  const B = lab(b);
  return fromLab([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t]);
};

export const isDark = (hex: string) => lab(hex)[0] < 0.6;
const chroma = (hex: string) => lch(hex)[1];

export const isViolet = (hex: string) => {
  const [, C, h] = lch(hex);
  return C > 0.05 && h > 275 && h < 330;
};

// A company site's quiet ground.
const paletteOk = (palette: Palette) =>
  chroma(palette.bg) < 0.045 && !isViolet(palette.accent) && !palette.tags.includes("flat-loud");

/** A place's ground: light, and low in saturation. */
export const placeGround = (palette: Palette) => {
  const channels = rgb(palette.bg);
  return (
    !isDark(palette.bg) &&
    lab(palette.bg)[0] >= 0.8 &&
    Math.max(...channels) - Math.min(...channels) <= 0.12
  );
};

// Grey text that reads on every ground at 4.5:1, keeping its hue.
const readableMuted = (muted: string, ink: string, grounds: ReadonlyArray<string>) => {
  let color = muted;
  for (let step = 0; step < 40 && grounds.some((ground) => contrast(color, ground) < 4.6); step++) {
    color = mix(color, ink, 0.08);
  }
  return color;
};

type Rng = () => number;

const shuffle = <A>(items: ReadonlyArray<A>, rng: Rng): Array<A> => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const held = out[i] as A;
    out[i] = out[j] as A;
    out[j] = held;
  }
  return out;
};

/** Fresh ones first in a random order, then the recent ones, the oldest first. */
const drawFresh = <A>(
  list: ReadonlyArray<A>,
  idOf: (item: A) => string,
  recent: ReadonlyArray<string>,
  rng: Rng,
): { readonly fresh: ReadonlyArray<A>; readonly stale: ReadonlyArray<A> } => ({
  fresh: shuffle(
    list.filter((item) => !recent.includes(idOf(item))),
    rng,
  ),
  stale: list
    .filter((item) => recent.includes(idOf(item)))
    .toSorted((a, b) => recent.lastIndexOf(idOf(a)) - recent.lastIndexOf(idOf(b))),
});
const paletteId = (palette: Palette) => palette.id;

const wpick = <A>(items: ReadonlyArray<A>, weight: (item: A) => number, rng: Rng) => {
  let r = rng() * items.reduce((total, item) => total + weight(item), 0);
  for (const item of items) {
    r -= weight(item);
    if (r <= 0) return item;
  }
  return items.at(-1);
};

const suits = (pairing: Pairing, kind: OzoneDesignKind) =>
  kind === "place" ? pairing.place !== undefined : (pairing.kinds?.[kind] ?? 0) > 0;
const kindWeight = (pairing: Pairing, kind: OzoneDesignKind) =>
  kind === "place" ? 1 : (pairing.kinds?.[kind] ?? 1);

// The trade's group first: a serif for a bakery or a guesthouse, a plain sans for a shop, a soft
// sans for a cafe.
const PLACE_GROUP: Partial<Record<OzoneDesignTrade, PlaceGroup>> = {
  bakery: "serif",
  hotel: "serif",
  restaurant: "serif",
  wedding: "serif",
  retail: "plain",
  workshop: "plain",
  studio: "plain",
  clinic: "plain",
  law: "plain",
  agency: "plain",
  wellness: "soft",
  cafe: "soft",
};

// null: design-taste-frontend deals as start.mjs does.
const SKILL_TAGS: Record<OzoneDesignSkill, ReadonlyArray<string> | null> = {
  "design-taste-frontend": null,
  "minimalist-ui": ["light-neutral", "earth", "pastel-fields"],
  "high-end-visual-design": ["light-neutral", "earth", "photographic-neutral"],
  "gpt-taste": ["two-tone", "single-field", "photographic-neutral"],
  "industrial-brutalist-ui": ["flat-loud", "two-tone", "light-neutral"],
};
const SKILL_CLASSES: Record<OzoneDesignSkill, ReadonlyArray<string> | null> = {
  "design-taste-frontend": null,
  "minimalist-ui": ["serif"],
  "high-end-visual-design": ["serif", "geometric", "wide"],
  "gpt-taste": ["geometric", "wide", "neo-grotesk"],
  "industrial-brutalist-ui": ["neo-grotesk", "wide", "slab"],
};
const OTHER_SKILLS = [
  "high-end-visual-design",
  "gpt-taste",
  "minimalist-ui",
  "industrial-brutalist-ui",
] as const satisfies ReadonlyArray<OzoneDesignSkill>;

const isSerif = (pairing: Pairing) => pairing.class === "serif" || pairing.class === "slab";

/** The ids one deal used, so the next can deal others. */
export interface DealIds {
  readonly skills: ReadonlyArray<OzoneDesignSkill>;
  readonly palettes: ReadonlyArray<string>;
  readonly pairings: ReadonlyArray<string>;
}

export interface DealRequest {
  readonly kind: OzoneDesignKind;
  readonly trade?: OzoneDesignTrade | undefined;
  readonly avoid?: DealIds | undefined;
}

export interface DesignSeed {
  readonly skill: OzoneDesignSkill;
  readonly palette: {
    readonly id: string;
    readonly name: string;
    readonly note: string;
    readonly colors: OzoneDesignDirection["colors"];
  };
  readonly type: {
    readonly id: string;
    readonly display: OzoneDesignFace;
    readonly body: OzoneDesignFace;
  };
  readonly fits: ReturnType<typeof skillFits>;
}

export const dealtIds = (seeds: ReadonlyArray<DesignSeed>): DealIds => ({
  skills: seeds.map((seed) => seed.skill),
  palettes: seeds.map((seed) => seed.palette.id),
  pairings: seeds.map((seed) => seed.type.id),
});

/**
 * Three seeds: design-taste-frontend first, then two of the other skills. Each gets its own palette
 * and pairing, the trade's palettes first, and away from what `avoid` names when others fit.
 */
export const deal = (
  library: DesignLibrary,
  { kind, trade, avoid = { skills: [], palettes: [], pairings: [] } }: DealRequest,
  rng: Rng = Math.random,
): ReadonlyArray<DesignSeed> => {
  const tech = TECH_KINDS.has(kind);
  const faces: ReadonlySet<string> = new Set(OZONE_DESIGN_FACES);
  const pairings = library.pairings.filter(
    (pairing) => faces.has(pairing.display.family) && faces.has(pairing.text.family),
  );
  const serifFamilies = new Set(pairings.filter(isSerif).map((pairing) => pairing.display.family));
  const kindPairings = pairings.filter((pairing) => suits(pairing, kind));
  // Dark pages are tech only.
  const grounds = library.palettes.filter(
    (palette) => !isViolet(palette.accent) && (tech || !isDark(palette.bg)),
  );
  const others = drawFresh(OTHER_SKILLS, (skill) => skill, avoid.skills, rng);
  const skills: ReadonlyArray<OzoneDesignSkill> = [
    "design-taste-frontend",
    ...[...others.fresh, ...others.stale].slice(0, 2),
  ];
  const takenPalettes: Array<string> = [];
  const takenPairings: Array<Pairing> = [];

  const dealPalette = (skill: OzoneDesignSkill, first: boolean) => {
    const tags = SKILL_TAGS[skill];
    const pool = grounds.filter(
      (palette) =>
        !takenPalettes.includes(palette.id) &&
        (tags === null ? paletteOk(palette) : palette.tags.some((tag) => tags.includes(tag))) &&
        (!(first && kind === "place") || placeGround(palette)),
    );
    const madeFor = pool.filter(
      (palette) => trade !== undefined && (palette.trades ?? []).includes(trade),
    );
    const fit = drawFresh(madeFor, paletteId, avoid.palettes, rng);
    const rest = drawFresh(
      pool.filter((palette) => !madeFor.includes(palette)),
      paletteId,
      avoid.palettes,
      rng,
    );
    return (
      [...fit.fresh, ...rest.fresh, ...fit.stale, ...rest.stale][0] ??
      grounds.find((palette) => !takenPalettes.includes(palette.id)) ??
      library.palettes[0]
    );
  };

  const dealPairing = (skill: OzoneDesignSkill, first: boolean) => {
    const classes = SKILL_CLASSES[skill];
    const ofSkill = (list: ReadonlyArray<Pairing>) =>
      classes === null ? list : list.filter((pairing) => classes.includes(pairing.class));
    const group = first && kind === "place" && trade !== undefined ? PLACE_GROUP[trade] : undefined;
    // A skill whose classes have nothing for this kind (minimalist-ui on a tech page) keeps its
    // classes over the kind, and only then takes the kind's own pairings.
    const pools = [
      group === undefined
        ? ofSkill(kindPairings)
        : kindPairings.filter((pairing) => pairing.place === group),
      ofSkill(pairings),
      kindPairings,
      pairings,
    ];
    let pool = pools.find((candidates) => candidates.length > 0) ?? [];
    const untaken = pool.filter((pairing) => !takenPairings.includes(pairing));
    if (untaken.length > 0) pool = untaken;
    const fresh = pool.filter((pairing) => !avoid.pairings.includes(pairing.id));
    if (fresh.length > 0) pool = fresh;
    const classesTaken = new Set(takenPairings.map((pairing) => pairing.class));
    // The kind's weight counts cubed, and a class already dealt is only dimmed.
    return (
      wpick(
        pool,
        (pairing) => kindWeight(pairing, kind) ** 3 * (classesTaken.has(pairing.class) ? 0.15 : 1),
        rng,
      ) ?? library.pairings[0]
    );
  };

  return skills.map((skill, slot): DesignSeed => {
    const palette = dealPalette(skill, slot === 0);
    const pairing = dealPairing(skill, slot === 0);
    takenPalettes.push(palette.id);
    takenPairings.push(pairing);
    return {
      skill,
      palette: {
        id: palette.id,
        name: palette.name,
        note: palette.note,
        colors: {
          background: palette.bg,
          surface: palette.surface,
          text: palette.ink,
          muted: readableMuted(palette.muted, palette.ink, [palette.bg, palette.surface]),
          accent: palette.accent,
          accentText: palette.accentInk,
        },
      },
      type: {
        id: pairing.id,
        display: { family: pairing.display.family, style: isSerif(pairing) ? "serif" : "sans" },
        body: {
          family: pairing.text.family,
          style: serifFamilies.has(pairing.text.family) ? "serif" : "sans",
        },
      },
      fits: skillFits(skill, { dark: isDark(palette.bg) }),
    };
  });
};
