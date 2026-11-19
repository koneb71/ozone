import {
  OZONE_DESIGN_FACES,
  type OzoneDesignComposition,
  type OzoneDesignCopy,
  type OzoneDesignDirection,
  type OzoneDesignFace,
  type OzoneDesignMaterial,
  type OzoneDesignMotion,
  type OzoneDesignSkill,
} from "@t3tools/contracts";
import type { CSSProperties } from "react";

/** A direction with every part the preview draws, including one from before Ozone 1.10. */
export interface ShownDirection {
  readonly direction: OzoneDesignDirection;
  readonly composition: OzoneDesignComposition;
  readonly material: OzoneDesignMaterial;
  readonly motion: OzoneDesignMotion;
  readonly copy: OzoneDesignCopy;
}

export const showDirection = (direction: OzoneDesignDirection): ShownDirection => ({
  direction,
  composition: direction.composition ?? "split",
  material: direction.material ?? "paper",
  motion: direction.motion ?? "lift",
  copy: direction.copy ?? {
    brand: direction.name,
    headline: direction.name,
    lede: direction.idea,
    cta: "Get started",
  },
});

export const SKILL_LABEL: Record<OzoneDesignSkill, string> = {
  "design-taste-frontend": "Taste",
  "high-end-visual-design": "High end",
  "gpt-taste": "Cinematic",
  "minimalist-ui": "Minimal",
  "industrial-brutalist-ui": "Brutalist",
};

export const MOTION_WORDS: Record<OzoneDesignMotion, string> = {
  lift: "Cards lift toward you",
  tilt: "Turns toward the pointer",
  rise: "Lines turn up into place",
  unfold: "The hero unfolds from flat",
  stack: "Cards fly in from depth",
  depth: "Layers drift apart in depth",
  flip: "Cells flip over",
};

export const COMPOSITION_WORDS: Record<OzoneDesignComposition, string> = {
  monument: "Headline as the picture",
  split: "Words beside the product",
  centred: "Centred over a window",
  bento: "A grid of tiles",
  cascade: "Cards stepping back",
  ledger: "A ruled blueprint grid",
  manuscript: "A page like a document",
};

export const MATERIAL_WORDS: Record<OzoneDesignMaterial, string> = {
  paper: "Paper",
  glass: "Glass",
  bezel: "Bezel",
  soft: "Soft",
  print: "Print",
  terminal: "Terminal",
};

const BUNDLED: ReadonlySet<string> = new Set(OZONE_DESIGN_FACES);

/** A bundled face of the same kind, for a face Ozone does not carry. */
const STAND_IN: Record<OzoneDesignFace["style"], string | null> = {
  serif: "Newsreader",
  sans: "Geist",
  display: "Bricolage Grotesque",
  mono: null,
  script: null,
};

const FALLBACK: Record<OzoneDesignFace["style"], string> = {
  serif: "ui-serif, Georgia, serif",
  sans: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, Menlo, monospace",
  display: "ui-sans-serif, system-ui, sans-serif",
  script: "cursive",
};

/** The family the preview loads for a face, or null when it has none of that kind. */
export const shownFamily = (face: OzoneDesignFace): string | null =>
  BUNDLED.has(face.family) ? face.family : STAND_IN[face.style];

/** The name Ozone registers a bundled face under, so a face installed on the device never wins. */
export const registeredName = (family: string) => `Ozone Design ${family}`;

const fontStack = (face: OzoneDesignFace): string => {
  const family = shownFamily(face);
  return family === null
    ? FALLBACK[face.style]
    : `"${registeredName(family)}", ${FALLBACK[face.style]}`;
};

/** The faces a direction's preview needs. */
export const facesOf = (direction: OzoneDesignDirection): ReadonlyArray<string> =>
  [shownFamily(direction.display), shownFamily(direction.body)].filter(
    (family): family is string => family !== null,
  );

/** `#rrggbb` at an opacity, for gradients and rings. */
const withAlpha = (hex: string, alpha: number) =>
  `${hex}${Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0")}`;

/**
 * The direction's colours and surfaces as CSS variables on the preview's root. Grounds are
 * gradients only: no filter or backdrop-filter, which would repaint on every frame of a turn.
 */
export function materialStyle(shown: ShownDirection): CSSProperties {
  const { colors } = shown.direction;
  const hairline = withAlpha(colors.text, 0.14);
  const base = {
    "--dp-bg": colors.background,
    "--dp-surface": colors.surface,
    "--dp-text": colors.text,
    "--dp-muted": colors.muted,
    "--dp-accent": colors.accent,
    "--dp-accent-text": colors.accentText,
    "--dp-hairline": hairline,
    "--dp-display": fontStack(shown.direction.display),
    "--dp-body": fontStack(shown.direction.body),
    "--dp-label":
      shown.material === "terminal" || shown.composition === "ledger"
        ? FALLBACK.mono
        : fontStack(shown.direction.body),
    "--dp-display-weight": shown.direction.display.style === "serif" ? "400" : "500",
  };
  const surfaces: Record<OzoneDesignMaterial, Record<string, string>> = {
    paper: {
      "--dp-radius": "0.7cqi",
      "--dp-panel": colors.surface,
      "--dp-panel-ring": `0 0 0 1px ${hairline}`,
      "--dp-panel-shadow": "0 0 0 0 transparent",
      "--dp-ground": colors.background,
    },
    glass: {
      "--dp-radius": "1.8cqi",
      "--dp-panel": withAlpha(colors.surface, 0.62),
      "--dp-panel-ring": `0 0 0 1px ${withAlpha("#ffffff", 0.22)}, inset 0 1px 0 ${withAlpha("#ffffff", 0.35)}`,
      "--dp-panel-shadow": `0 2cqi 5cqi -1.5cqi ${withAlpha(colors.text, 0.22)}`,
      "--dp-ground": `radial-gradient(60% 70% at 78% 18%, ${withAlpha(colors.accent, 0.42)}, transparent 70%), radial-gradient(55% 60% at 12% 92%, ${withAlpha(colors.muted, 0.32)}, transparent 70%), ${colors.background}`,
    },
    bezel: {
      "--dp-radius": "2cqi",
      "--dp-panel": colors.surface,
      "--dp-panel-ring": `0 0 0 0.55cqi ${withAlpha(colors.text, 0.05)}, 0 0 0 calc(0.55cqi + 1px) ${withAlpha(colors.text, 0.1)}, inset 0 1px 0 ${withAlpha("#ffffff", 0.5)}`,
      "--dp-panel-shadow": `0 1.6cqi 3.6cqi -1.6cqi ${withAlpha(colors.text, 0.18)}`,
      "--dp-ground": colors.background,
    },
    soft: {
      "--dp-radius": "2.6cqi",
      "--dp-panel": colors.surface,
      "--dp-panel-ring": "0 0 0 0 transparent",
      "--dp-panel-shadow": `0 1.4cqi 4cqi -1cqi ${withAlpha(colors.text, 0.16)}, 0 0.3cqi 0.8cqi ${withAlpha(colors.text, 0.06)}`,
      "--dp-ground": `linear-gradient(180deg, ${colors.background}, ${withAlpha(colors.surface, 0.9)})`,
    },
    print: {
      "--dp-radius": "0px",
      "--dp-panel": colors.surface,
      "--dp-panel-ring": `0 0 0 0.25cqi ${colors.text}`,
      "--dp-panel-shadow": `0.7cqi 0.7cqi 0 ${colors.text}`,
      "--dp-ground": colors.background,
    },
    terminal: {
      "--dp-radius": "0.3cqi",
      "--dp-panel": withAlpha(colors.surface, 0.9),
      "--dp-panel-ring": `0 0 0 1px ${withAlpha(colors.accent, 0.45)}`,
      "--dp-panel-shadow": `0 0 3cqi -1cqi ${withAlpha(colors.accent, 0.35)}`,
      "--dp-ground": `repeating-linear-gradient(0deg, ${withAlpha(colors.text, 0.035)} 0 1px, transparent 1px 0.6cqi), ${colors.background}`,
    },
  };
  return { ...base, ...surfaces[shown.material] } as CSSProperties;
}

/** Headline size in `cqi`, so a long headline still fits the composition in three lines or fewer. */
export function headlineSize(composition: OzoneDesignComposition, text: string): number {
  const width: Record<OzoneDesignComposition, { readonly max: number; readonly measure: number }> =
    {
      monument: { max: 10.5, measure: 88 },
      split: { max: 6.2, measure: 48 },
      centred: { max: 6.4, measure: 70 },
      bento: { max: 5.2, measure: 54 },
      cascade: { max: 6, measure: 44 },
      ledger: { max: 5.6, measure: 50 },
      manuscript: { max: 6.8, measure: 44 },
    };
  const { max, measure } = width[composition];
  // A display glyph averages about half an em wide: three lines hold `measure * 3 / (size * 0.52)` letters.
  const fits = (measure * 3) / (Math.max(text.length, 1) * 0.52);
  return Math.round(Math.min(max, Math.max(max * 0.45, fits)) * 100) / 100;
}

/** What a motion animates. Every composition draws each of these. */
export type MotionPart = "word" | "lede" | "cta" | "visual" | "card" | "scene" | "layer" | "sheen";

export interface MotionStep {
  readonly part: MotionPart;
  /** The same frames for every element of the part, or frames for the element at `index`. */
  readonly keyframes: ReadonlyArray<Keyframe> | ((index: number) => ReadonlyArray<Keyframe>);
  readonly duration: number;
  readonly delay: number;
  /** Added to `delay` for each further element of the part. */
  readonly stagger: number;
  readonly easing: string;
  /** At most this many elements of the part move; the rest stand still. */
  readonly limit: number;
}

const SETTLE = "cubic-bezier(.22,1,.36,1)";
const TRAVEL = "cubic-bezier(.65,0,.35,1)";
const REST: Keyframe = { transform: "none", opacity: 1 };

const step = (
  part: MotionPart,
  keyframes: MotionStep["keyframes"],
  timing: Partial<Omit<MotionStep, "part" | "keyframes">> = {},
): MotionStep => ({
  part,
  keyframes,
  duration: 700,
  delay: 0,
  stagger: 0,
  easing: SETTLE,
  limit: 1,
  ...timing,
});

const fadeUp = (delay: number) => [
  step("lede", [{ transform: "translateY(1.6cqi)", opacity: 0 }, REST], { delay, duration: 520 }),
  step("cta", [{ transform: "translateY(1.6cqi)", opacity: 0 }, REST], {
    delay: delay + 90,
    duration: 520,
  }),
];

/**
 * The preview's run of each motion: played once, ending where the screen rests, so the frame
 * after it and the frame under reduced motion are the same.
 */
export const MOTION_PLAN: Record<OzoneDesignMotion, ReadonlyArray<MotionStep>> = {
  lift: [
    step(
      "card",
      [
        { transform: "translate3d(0, 5cqi, -12cqi) rotateX(14deg)", opacity: 0 },
        { transform: "translate3d(0, -0.8cqi, 3cqi)", opacity: 1, offset: 0.62 },
        REST,
      ],
      { duration: 900, stagger: 110, limit: 4 },
    ),
    step("visual", [{ transform: "translate3d(0, 2cqi, -6cqi)", opacity: 0 }, REST], {
      duration: 800,
    }),
    ...fadeUp(260),
  ],
  tilt: [
    step(
      "scene",
      [
        { transform: "rotateX(9deg) rotateY(-16deg) scale(.93)" },
        { transform: "rotateX(-3deg) rotateY(7deg) scale(.98)", offset: 0.55 },
        { transform: "none" },
      ],
      { duration: 1400, easing: TRAVEL },
    ),
    step(
      "sheen",
      [
        { transform: "translateX(-120%) skewX(-18deg)", opacity: 0 },
        { opacity: 0.5, offset: 0.4 },
        { transform: "translateX(220%) skewX(-18deg)", opacity: 0 },
      ],
      { duration: 1200, delay: 150, easing: TRAVEL },
    ),
  ],
  rise: [
    step("word", [{ transform: "translateY(105%) rotateX(-55deg)", opacity: 0 }, REST], {
      duration: 760,
      stagger: 55,
      limit: 9,
    }),
    ...fadeUp(420),
  ],
  unfold: [
    step(
      "visual",
      [
        { transform: "rotateX(84deg)", opacity: 0 },
        { transform: "rotateX(-5deg)", opacity: 1, offset: 0.72 },
        REST,
      ],
      { duration: 1050 },
    ),
    step("card", [{ transform: "rotateX(60deg)", opacity: 0 }, REST], {
      delay: 380,
      stagger: 90,
      limit: 4,
    }),
    ...fadeUp(200),
  ],
  stack: [
    step("card", [{ transform: "translate3d(0, 3cqi, -34cqi) rotateX(28deg)", opacity: 0 }, REST], {
      duration: 820,
      stagger: 95,
      limit: 5,
    }),
    step("visual", [{ transform: "translate3d(0, 0, -20cqi)", opacity: 0 }, REST], {
      duration: 900,
    }),
    ...fadeUp(300),
  ],
  depth: [
    step(
      "scene",
      [
        { transform: "rotateX(20deg) rotateY(-24deg) scale(.82)" },
        { transform: "rotateX(12deg) rotateY(-14deg) scale(.88)", offset: 0.5 },
        { transform: "none" },
      ],
      { duration: 1500, easing: TRAVEL },
    ),
    step(
      "layer",
      (index) => [
        { transform: `translateZ(${(index + 1) * 6}cqi)` },
        { transform: `translateZ(${(index + 1) * 6}cqi)`, offset: 0.5 },
        { transform: "none" },
      ],
      { duration: 1500, easing: TRAVEL, limit: 4 },
    ),
  ],
  flip: [
    step(
      "card",
      [
        { transform: "rotateX(-92deg)", opacity: 0.4 },
        { transform: "rotateX(8deg)", offset: 0.75 },
        REST,
      ],
      { duration: 640, stagger: 70, limit: 6 },
    ),
    step("cta", [{ transform: "rotateX(-92deg)" }, REST], { delay: 420, duration: 560 }),
  ],
};

export const framesFor = (motionStep: MotionStep, index: number): ReadonlyArray<Keyframe> =>
  typeof motionStep.keyframes === "function" ? motionStep.keyframes(index) : motionStep.keyframes;

/** How long a motion runs from its first frame to its last. */
export const motionLength = (motion: OzoneDesignMotion) =>
  Math.max(...MOTION_PLAN[motion].map((s) => s.delay + s.stagger * (s.limit - 1) + s.duration));

/** One face of the turn between two directions, about a pivot half the stage's width back. */
export function turnKeyframes(forward: boolean): {
  readonly out: ReadonlyArray<Keyframe>;
  readonly in: ReadonlyArray<Keyframe>;
} {
  const pivot = (deg: number) => `translateZ(-50cqi) rotateY(${deg}deg) translateZ(50cqi)`;
  const away = forward ? -90 : 90;
  return {
    out: [
      { transform: pivot(0), opacity: 1 },
      { transform: pivot(away), opacity: 0.85 },
    ],
    in: [
      { transform: pivot(-away), opacity: 0.85 },
      { transform: pivot(0), opacity: 1 },
    ],
  };
}

export const TURN_MS = 620;
export const TURN_EASING = TRAVEL;

export const wrapIndex = (index: number, length: number) => ((index % length) + length) % length;
