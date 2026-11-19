/**
 * What each design skill looks like, which first screens, surfaces and motions suit it, and the
 * recipe DESIGN.md gives for each. Model-facing: `NEXT.designDeal` and `designFile` quote it.
 */
import type {
  OzoneDesignComposition,
  OzoneDesignKind,
  OzoneDesignMaterial,
  OzoneDesignMotion,
  OzoneDesignSkill,
} from "@t3tools/contracts";

/** The kinds of page that may have a dark ground. */
export const TECH_KINDS: ReadonlySet<OzoneDesignKind> = new Set(["tech", "software", "gaming"]);

export const SKILL_VOICE: Record<OzoneDesignSkill, string> = {
  "design-taste-frontend":
    "A professional company site: plain copy, one section per screen, equal edges, real photographs or the real product, quiet hover motion.",
  "high-end-visual-design":
    "Agency polish: generous whitespace, soft depth, cards nested in a bezel, pill buttons and slow, weighty motion.",
  "gpt-taste":
    "Cinematic and bold: wide headlines in two or three lines, gapless bento grids, high-contrast fields and motion tied to the scroll.",
  "minimalist-ui":
    "Quiet editorial: warm monochrome, a serif headline, hairline borders, flat tiles and small muted pastel tags.",
  "industrial-brutalist-ui":
    "Swiss print and control panel: rigid ruled grids, huge tight type, square corners, one hard accent and small mono labels.",
};

interface SkillFits {
  readonly compositions: ReadonlyArray<OzoneDesignComposition>;
  readonly materials: ReadonlyArray<OzoneDesignMaterial>;
  readonly motions: ReadonlyArray<OzoneDesignMotion>;
}

// Any deal of three skills leaves each direction its own composition, material and motion.
const SKILL_FITS: Record<OzoneDesignSkill, SkillFits> = {
  "design-taste-frontend": {
    compositions: ["split", "centred", "monument", "bento"],
    materials: ["paper", "soft", "glass", "terminal"],
    motions: ["lift", "rise", "unfold", "depth"],
  },
  "high-end-visual-design": {
    compositions: ["cascade", "split", "bento"],
    materials: ["bezel", "glass", "soft"],
    motions: ["tilt", "stack", "unfold", "depth"],
  },
  "gpt-taste": {
    compositions: ["centred", "monument", "bento", "cascade"],
    materials: ["glass", "soft", "print"],
    motions: ["rise", "stack", "depth", "unfold"],
  },
  "minimalist-ui": {
    compositions: ["manuscript", "bento", "split"],
    materials: ["paper", "print"],
    motions: ["lift", "rise", "unfold"],
  },
  // Square corners only: paper's radius is not this skill's.
  "industrial-brutalist-ui": {
    compositions: ["ledger", "monument", "manuscript"],
    materials: ["print", "terminal"],
    motions: ["flip", "rise", "stack"],
  },
};

/** What suits a skill on the ground it was dealt: the terminal look needs a dark one. */
export const skillFits = (
  skill: OzoneDesignSkill,
  { dark }: { readonly dark: boolean },
): SkillFits => {
  const fits = SKILL_FITS[skill];
  return dark
    ? fits
    : { ...fits, materials: fits.materials.filter((material) => material !== "terminal") };
};

const SETTLE = "cubic-bezier(.22,1,.36,1)";
const TRAVEL = "cubic-bezier(.65,0,.35,1)";

export const COMPOSITION_RECIPE: Record<OzoneDesignComposition, string> = {
  monument:
    "The headline is the picture: one to three lines at `clamp(3.5rem, 10vw, 9rem)`, line-height 0.92, letter-spacing -0.04em, across the full width between the content edges. The lede and the button sit under it on the left, at most a third of the width wide. No hero image.",
  split:
    "Two columns from 1024px (`grid-template-columns: 5fr 7fr`, gap `clamp(2rem, 5vw, 5rem)`): the headline, lede and button on the left, vertically centred; on the right the product, a photograph or the app's own screen, filling its column to the bottom of the first screen. Below 768px it stacks, text first.",
  centred:
    "A centred headline (max-width 18ch, `clamp(2.75rem, 6vw, 5.5rem)`), the lede (max-width 52ch) and the button under it, then a wide window of the product (max-width 1200px, with the corners of the surfaces below) whose bottom edge the fold cuts off, so it carries on below.",
  bento:
    "The headline and button on top, then a grid of unequal tiles (`grid-template-columns: repeat(12, 1fr)`, gap 12px, `grid-auto-flow: dense`): one tile spans 7 columns and 2 rows, the others 5 or 4 columns, with no empty cell. Each tile holds one real thing: a figure, a screen, a photograph or a short list. One column below 768px.",
  cascade:
    "Three or four cards overlap in depth beside the headline, under `perspective: 1200px`: each one 32px lower and 24px further in than the last, set back by `translateZ(-40px)` per step. Below 768px they lie flat in one column with no overlap.",
  ledger:
    "A ruled blueprint grid: `display: grid; gap: 1px` over a background of the text colour at 15%, so the gaps draw the hairlines. The headline fills the largest cell; small labels in the system mono stack (`ui-monospace, SFMono-Regular, Menlo, monospace`), figures and the button fill the others. Square corners throughout.",
  manuscript:
    "A left-weighted page like a document: one column, max-width 42rem, on the left content edge, with a large headline, the lede as its first paragraph and the button inline after it. A narrow right margin carries two or three short notes or facts. Below 768px the notes follow the text.",
};

export const MATERIAL_RECIPE: Record<OzoneDesignMaterial, string> = {
  paper:
    "Flat surfaces with 1px hairlines in the text colour at 10 to 12%, radius 8px to 12px, and no shadows.",
  glass:
    "Panels in the surface colour at 72% opacity over a soft radial field of the accent at 10 to 16% on the background, a 1px top highlight in white at 20%, radius 20px. No `backdrop-filter` on anything that scrolls.",
  bezel:
    "Each card is a shell around an inset core: the shell in the text colour at 4% with a 1px ring at 6%, padding 6px, radius 28px; the core in the surface colour, radius 22px, with an inner highlight `inset 0 1px 0 rgb(255 255 255 / .15)`.",
  soft: "Large radii (24px on cards, full pills on buttons) and soft layered shadows: `0 1px 2px rgb(0 0 0 / .04), 0 12px 32px -12px rgb(0 0 0 / .14)`. No hard borders.",
  print:
    "Hard edges and solid rules: square corners, 2px rules in the text colour between zones, no shadows and no gradients. The accent appears only as solid fills and rules.",
  terminal:
    "The background colour as the ground, with mono details: labels, figures and the nav in the system mono stack (`ui-monospace, SFMono-Regular, Menlo, monospace`) at 12px, uppercase, letter-spacing 0.08em; 1px borders in the text colour at 14%; square corners.",
};

export const MOTION_RECIPE: Record<OzoneDesignMotion, { build: string; reduced: string }> = {
  lift: {
    build: `Linked cards and the main button rise toward the viewer on hover and focus: \`translateZ(24px)\` under \`perspective: 800px\` on their parent (\`translateY(-4px)\` where there is no 3D parent), with a deeper shadow where the surfaces have shadows and a darker border where they have none, over 220ms ${SETTLE}, and settle back the same way.`,
    reduced: "A border or background colour change instead of the movement.",
  },
  tilt: {
    build: `The hero visual and linked cards turn toward the pointer, up to 8deg on each axis (\`rotateX\` and \`rotateY\` under \`perspective: 1000px\`), with a sheen: a radial highlight in white at 12% that follows the pointer. On leave they ease back to flat over 400ms ${SETTLE}. Read the pointer in one \`requestAnimationFrame\` per frame. Never tilt text, buttons or forms.`,
    reduced: "No tilt and no sheen.",
  },
  rise: {
    build: `On load the headline's lines settle into place: each line in an \`overflow: hidden\` mask, from \`translateY(100%) rotateX(-40deg)\` with \`transform-origin: bottom\` to none, over 700ms ${SETTLE}, 80ms apart. The lede and button follow with a 12px rise and fade. Section headings do the same once, on first view.`,
    reduced: "Every line in place from the first frame.",
  },
  unfold: {
    build: `On load the hero visual stands up from flat: from \`rotateX(55deg) translateY(40px)\` at opacity 0, \`transform-origin: bottom\`, under \`perspective: 1200px\`, to none over 900ms ${SETTLE}. Section visuals unfold the same way as they enter, with \`animation-timeline: view()\` and \`animation-range: entry 0% entry 60%\`.`,
    reduced: "Flat and in place from the first frame.",
  },
  stack: {
    build: `Cards fly in from depth: from \`translateZ(-200px) translateY(24px)\` at opacity 0, under \`perspective: 1200px\`, to none over 600ms ${SETTLE}, 90ms apart. The hero's cards do it once on load, a section's cards once on first view.`,
    reduced: "Every card in place from the first frame.",
  },
  depth: {
    build:
      "The hero's three or four layers (ground, visual, cards, text) sit at different depths under `perspective: 1200px` and drift apart as the page scrolls past the hero: `translateY` of 0, -4%, -8% and -12% across it, with `animation-timeline: scroll()`. The text layer moves least.",
    reduced: "Every layer at rest.",
  },
  flip: {
    build: `Split-flap cells turn on load: figures and short labels flip from \`rotateX(-90deg)\` to none in 320ms ${TRAVEL}, 60ms apart. Cards have a back face (\`transform-style: preserve-3d\`, \`backface-visibility: hidden\`) that turns over with \`rotateY(180deg)\` over 560ms ${TRAVEL} on hover, focus or tap.`,
    reduced: "A 160ms crossfade between the faces instead of a turn.",
  },
};
