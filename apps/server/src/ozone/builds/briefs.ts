/**
 * The text a build sends to agents: each worker's brief, the `next` line of every report, and
 * what a lead reads when the server wakes it. Model-facing: the design steps have eval cases in
 * `evals/mcp-tool-use/cases/design-directions.ndjson`. After any other change, run a real build
 * and read what agents do.
 */
import {
  OZONE_DESIGN_FACES,
  OZONE_VERIFICATION_ID,
  type OzoneBuild,
  type OzoneBuildTask,
  type OzoneBuildVerification,
  type OzoneCriterionResult,
  type OzoneDesignDirection,
  type OzoneGateResult,
  type ThreadId,
} from "@t3tools/contracts";

import type { WakeNote } from "./BuildWake.ts";
import type { DesignSeed } from "./designDeal.ts";
import {
  COMPOSITION_RECIPE,
  MATERIAL_RECIPE,
  MOTION_RECIPE,
  SKILL_VOICE,
} from "./designVocabulary.ts";

const bullets = (lines: ReadonlyArray<string>) => lines.map((line) => `- ${line}`).join("\n");

/** The look the person picked, in the app's root. Its presence ends design mode's question. */
export const DESIGN_FILE = "DESIGN.md";

/** Why `ozone_design_propose` refuses an app made from a template without pages. */
export const NO_PAGES = "This app has no pages, so it has no design to pick.";

/** Everything a worker is told. It starts with `Ozone task`, which the app's AGENTS.md keys on. */
export const workerBrief = (
  build: OzoneBuild,
  task: OzoneBuildTask,
  checks: ReadonlyArray<string>,
): string => {
  const position = build.tasks.findIndex((candidate) => candidate.id === task.id) + 1;
  const sections = [`Ozone task ${position} of ${build.tasks.length}: ${task.title}`, task.brief];
  if (task.acceptance.length > 0) {
    sections.push(`It is done when:\n${bullets(task.acceptance)}`);
  }
  const failures = task.evidence.filter((gate) => !gate.ok);
  // After a retry ruling the count starts over, but what went wrong still has to be said.
  if (task.attempts > 0 || failures.length > 0) {
    sections.push(
      [
        task.attempts > 0
          ? `This is attempt ${task.attempts + 1} of ${build.maxAttempts}. The last attempt did not pass:`
          : "Earlier attempts at this task did not pass:",
        bullets(
          failures.length === 0
            ? ["Its worker stopped before finishing."]
            : failures.map((gate) => `${gate.id}: ${gate.detail}`),
        ),
        ...(task.summary === null ? [] : [`The last worker reported: ${task.summary}`]),
        "Its changes are still in the working tree. Fix the cause, not the check.",
      ].join("\n"),
    );
  }
  sections.push(
    [
      "How to work:",
      bullets([
        "The spec is in .ozone/spec.md and the whole plan in .ozone/plan.md. Read them only if you need the wider picture.",
        "Run every command through ./dev, for example `./dev npm run typecheck`.",
        `If the task changes how a page looks, read ${DESIGN_FILE} first if there is one, then the Design section of AGENTS.md. Build the motion ${DESIGN_FILE} names, with its reduced-motion fallback.`,
        task.access === "read"
          ? "This task is read-only. Change no files."
          : `Do not commit, and do not start, stop or rebuild the app. Ozone runs the checks itself (${checks.join(", ")}) and commits your work when they pass.`,
        "Finish with what you changed, what the next task must know, and anything you could not finish.",
      ]),
    ].join("\n"),
  );
  return sections.join("\n\n");
};

export const NEXT = {
  plan: "There is no plan yet. Call ozone_build_plan with the spec, the acceptance criteria and the tasks.",
  planned: "The plan is saved. Call ozone_build_advance to start the first task.",
  chooseDesign: `Nothing was saved: the user asked to pick this app's design, and it has no ${DESIGN_FILE} yet. Call ozone_design_propose with the app's \`kind\`, its \`trade\` if one fits, and no directions, then follow what it returns. Do not ask with your question tool.`,
  designDeal: (seeds: ReadonlyArray<DesignSeed>) =>
    [
      "Nothing is shown yet. Ozone dealt one seed per direction from the design skills in .agents/skills:",
      ...seeds.map((seed, index) => {
        const { colors } = seed.palette;
        return [
          "",
          `${index + 1}. \`${seed.skill}\`: ${SKILL_VOICE[seed.skill]}`,
          `   Colours, "${seed.palette.name}": background ${colors.background}, surface ${colors.surface}, text ${colors.text}, muted ${colors.muted}, accent ${colors.accent}, accentText ${colors.accentText}. ${seed.palette.note}`,
          `   Faces: display ${seed.type.display.family} (${seed.type.display.style}), body ${seed.type.body.family} (${seed.type.body.style}).`,
          `   Fits: composition ${seed.fits.compositions.join(", ")}; material ${seed.fits.materials.join(", ")}; motion ${seed.fits.motions.join(", ")}.`,
        ].join("\n");
      }),
      "",
      "Now:",
      bullets([
        "Read each seed's .agents/skills/<skill>/SKILL.md only for its voice and look. Run nothing, and skip its planning steps, such as `<design_plan>`, simulated Python, gate.mjs and start.mjs.",
        "Call ozone_design_propose again with the same `kind` and one direction per seed, in this order. Keep each seed's skill, and keep its colours and faces unless they clash with the request.",
        "Give each direction a `composition`, `material` and `motion` from its seed's lists, with no two directions sharing one.",
        'Write the `copy` this app would really ship: its brand, headline, lede and button. No placeholder, no "Welcome to", and not the direction\'s name.',
        `Then end your turn: Ozone shows the directions to the user, writes their pick to ${DESIGN_FILE} and wakes you.`,
      ]),
    ].join("\n"),
  designWaiting: `Nothing was saved: the user has not picked one of your design directions yet. End your turn: Ozone wakes you when they pick. If they ask for other looks instead, call ozone_design_propose with \`kind\` and no directions for new seeds. To change one direction, send all of them again.`,
  designShown: `Ozone is showing your directions to the user. End your turn: Ozone writes their pick to ${DESIGN_FILE} and wakes you. If they ask for other looks instead, call ozone_design_propose with \`kind\` and no directions for new seeds. To change one direction, send all of them again.`,
  planning:
    "Nothing was saved: you are in plan mode, and the user reviews your plan in the thread. Present the plan there and end your turn. Call ozone_build_plan after they approve it.",
  review:
    "The plan is saved, and nothing is built until the user approves it. Tell the user in a few sentences what you plan to build, and that they start it from the plan shown above the message box. Then end your turn; you are woken when they approve. If they ask for changes, call ozone_build_plan again. You cannot start it for them: if they tell you in the chat to go ahead, ask them to press Start on the plan above the message box.",
  advance: "Call ozone_build_advance.",
  complete: (url: string, verification: OzoneBuildVerification) =>
    [
      `The build is complete and the app is running at ${url}.`,
      ...(verification.status === "passed"
        ? ["A tester used the app in a browser, and what it tried works."]
        : verification.status === "unavailable"
          ? [
              `No tester could try the app in a browser${verification.note === null ? "" : ` (${verification.note})`}, so only the project's own checks vouch for it. Say so.`,
            ]
          : []),
      "Tell the user what was built and where to try it, with the full address of each new page. Do not call ozone_build_advance again.",
    ].join(" "),
  working: (task: OzoneBuildTask) =>
    `A worker is still on task ${task.id}. End your turn now. You are woken when it finishes; then call ozone_build_advance again.`,
  checking: (task: OzoneBuildTask) =>
    `Ozone is checking task ${task.id}. End your turn now. You are woken when the checks finish; then call ozone_build_advance again.`,
  finalChecking:
    "Every task passed and the final check is running. End your turn now. You are woken when it finishes; then call ozone_build_advance again.",
  verifying:
    "A tester is using the app in a browser. End your turn now. You are woken when it finishes; then call ozone_build_advance again.",
  needsAnswer: (who: string, workerThreadId: ThreadId | null) =>
    `${who} is waiting for an answer in its thread${workerThreadId === null ? "" : ` ${workerThreadId}`}. Answer it with t3_pending_request if you can, or ask the user, then call ozone_build_advance again.`,
  blocked: (task: OzoneBuildTask) =>
    `Task ${task.id} is blocked: ${task.blockedReason ?? "it needs a decision."} Rule on it with ozone_build_resolve: retry (with a note on what to do differently), skip, or accept. Ask the user first only if the choice changes what they get.`,
  finalFailed: (failed: ReadonlyArray<OzoneGateResult>) =>
    [
      `Every task passed, but the final check failed (${failed.map((gate) => gate.id).join(", ")}).`,
      ...failed.map((gate) => `${gate.id}: ${gate.detail}`),
      "The build is not done. Add a task that fixes it with ozone_build_plan, keeping the finished tasks, then call ozone_build_advance.",
    ].join("\n"),
  verifyFailed: (results: ReadonlyArray<OzoneCriterionResult>) =>
    [
      "Every check passed, but a tester used the app in a browser and it does not do what was asked:",
      ...results
        .filter((result) => result.verdict === "fail")
        .map((result) => `- ${result.criterion}: ${result.note}`),
      `The build is not done. Add a task that fixes it with ozone_build_plan, keeping the finished tasks, then call ozone_build_advance. If the tester is wrong, call ozone_build_resolve with taskId \`${OZONE_VERIFICATION_ID}\`: \`retry\` has the app tried again, \`accept\` keeps the build and needs a note saying why.`,
    ].join("\n"),
  checksPass: "Every check passes.",
  finalPasses:
    "Every check passes, the final one too. Call ozone_build_advance to finish the build.",
  waitingOnPlan:
    "Nothing can start: the remaining tasks wait on tasks that are not in the plan as done. Revise the plan with ozone_build_plan.",
} as const;

const AFTER_A_WAKE = "Call ozone_build_advance to see the result and take the next step.";

/** What the server says when it brings a lead back. The report of the next call says the rest. */
export const WAKE = {
  taskChecked: (task: OzoneBuildTask, passed: boolean): WakeNote => ({
    summary: `${passed ? "Checks passed" : "Checks failed"}: ${task.title}`,
    text: `Ozone has checked task ${task.id}. ${AFTER_A_WAKE}`,
    outcome: passed ? "completed" : "failed",
  }),
  finalChecked: (passed: boolean): WakeNote => ({
    summary: passed ? "The final check passed" : "The final check failed",
    text: `Ozone has run the final check. ${AFTER_A_WAKE}`,
    outcome: passed ? "completed" : "failed",
  }),
  checkBroke: (message: string): WakeNote => ({
    summary: "The checks could not run",
    text: `Ozone could not run its checks: ${message} Call ozone_build_advance to run them again, and tell the user if that fails too.`,
    outcome: "failed",
  }),
  approved: {
    summary: "Plan approved",
    text: "The user approved the plan. Call ozone_build_advance to start building.",
    outcome: "completed",
  } satisfies WakeNote,
  designPicked: (name: string): WakeNote => ({
    summary: `Design picked: ${name}`,
    text: `The user picked the "${name}" design, and Ozone wrote it to ${DESIGN_FILE}. Call ozone_build_plan to plan the build: its first task builds the first screen ${DESIGN_FILE} describes, with its motion. If the app is already built, revise the plan with a task that brings it to ${DESIGN_FILE}.`,
    outcome: "completed",
  }),
  designLeft: {
    summary: "Design left to the lead",
    text: "The user left the design to you. Choose it with the Design section of AGENTS.md, then call ozone_build_plan.",
    outcome: "completed",
  } satisfies WakeNote,
} as const;

const COLOR_ROLES = [
  ["background", "Background"],
  ["surface", "Surface: cards, inputs, raised areas"],
  ["text", "Text"],
  ["muted", "Muted text"],
  ["accent", "Accent: buttons and links"],
  ["accentText", "Text on the accent"],
] as const;

const colorsSection = (direction: OzoneDesignDirection) => [
  "## Colours",
  "",
  "| Role | Hex |",
  "| --- | --- |",
  ...COLOR_ROLES.map(([role, label]) => `| ${label} | \`${direction.colors[role]}\` |`),
  "",
  "These are the main theme. Make the other theme from the same colours, and keep the accent readable on both.",
  "",
];

// Every face Ozone deals has an `@fontsource-variable` package except these two.
const STATIC_FACES: ReadonlySet<string> = new Set(["Instrument Serif", "Zilla Slab"]);
const DEALT_FACES: ReadonlySet<string> = new Set(OZONE_DESIGN_FACES);
const fontPackage = (family: string) => {
  const slug = family.toLowerCase().replace(/\s+/g, "-");
  return DEALT_FACES.has(family) && !STATIC_FACES.has(family)
    ? `@fontsource-variable/${slug}`
    : `@fontsource/${slug}`;
};

const DESIGN_SKILL = "design-taste-frontend";

/** The direction the person picked, as the app's DESIGN.md. */
export const designFile = (
  direction: OzoneDesignDirection,
  { skillFile }: { readonly skillFile: boolean },
): string => {
  const { skill, composition, material, motion, copy } = direction;
  const intro = [
    `# Design: ${direction.name}`,
    "",
    direction.idea,
    "",
    "The user picked this look in Ozone. Every page follows it.",
    "",
  ];
  // A proposal from 1.9.0 has none of the newer keys.
  if ([skill, composition, material, motion, copy].every((value) => value === undefined)) {
    return [
      ...intro,
      ...colorsSection(direction),
      "## Type",
      "",
      `- Display: ${direction.display.family} (${direction.display.style})`,
      `- Body: ${direction.body.family} (${direction.body.style})`,
      "",
      "Load both from `@fontsource` packages.",
      "",
      "## First screen",
      "",
      direction.layout,
      "",
      "## Mood",
      "",
      direction.mood,
      "",
    ].join("\n");
  }
  const section = (lines: ReadonlyArray<string>) => [...lines, ""];
  return [
    ...intro,
    ...(skill !== undefined && skillFile
      ? section([
          "## Follow",
          "",
          `\`.agents/skills/${skill}/SKILL.md\` for layout and components. Where it names fonts, colours, icon sets, image services such as picsum.photos, animation libraries such as GSAP or Framer Motion, or planning steps such as \`<design_plan>\` or \`start.mjs deal\`, this file wins. Skip any step of it whose file is not in this app.`,
          ...(skill === DESIGN_SKILL
            ? []
            : [
                "",
                `Apart from the motion this file names, page motion follows the hover layer of \`.agents/skills/${DESIGN_SKILL}/SKILL.md\`. The entrance, scroll and loop rules of \`${skill}\` do not apply.`,
              ]),
        ])
      : []),
    ...section([
      "## First screen",
      "",
      ...(composition === undefined ? [] : [COMPOSITION_RECIPE[composition], ""]),
      ...(copy === undefined
        ? []
        : [
            `- Brand: ${copy.brand}`,
            `- Headline: ${copy.headline}`,
            `- Lede: ${copy.lede}`,
            `- Button: ${copy.cta}`,
            ...(copy.facts === undefined || copy.facts.length === 0
              ? []
              : [`- Facts: ${copy.facts.join("; ")}`]),
            "",
          ]),
      direction.layout,
    ]),
    ...colorsSection(direction),
    ...section([
      "## Type",
      "",
      `- Display: ${direction.display.family} (${direction.display.style}), from \`${fontPackage(direction.display.family)}\``,
      `- Body: ${direction.body.family} (${direction.body.style}), from \`${fontPackage(direction.body.family)}\``,
    ]),
    ...(material === undefined ? [] : section(["## Surfaces", "", MATERIAL_RECIPE[material]])),
    ...(motion === undefined
      ? []
      : section([
          "## Motion",
          "",
          `\`${motion}\`: ${MOTION_RECIPE[motion].build}`,
          "",
          `Reduced-motion fallback: ${MOTION_RECIPE[motion].reduced}`,
          "",
          bullets([
            `It plays once (on load, hover, focus or first view) or moves only with the scroll, then stands still. ${
              skill === undefined || skill === DESIGN_SKILL
                ? `The loops ${DESIGN_SKILL} deals on tech pages are unchanged.`
                : "Apart from it, the page moves only on hover and focus."
            }`,
            "Animate only `transform` and `opacity`, and `clip-path` for masks. Set `will-change` only while something moves.",
            "Build it with CSS keyframes, the Web Animations API, and scroll-driven animations inside `@supports (animation-timeline: view())`. No animation library: no GSAP, no Framer Motion.",
            "Pointer effects only under `@media (hover: hover) and (pointer: fine)`.",
            'Under reduced motion use the fallback: the `motion-reduce:` variant in markup, and a `matchMedia("(prefers-reduced-motion: reduce)")` check before attaching any listener.',
            "It applies to public pages and the first screen. Screens behind sign-in, if the app has any, keep only the hover and focus part: no entrance, first-view or scroll motion on lists, tables or forms.",
            `For the motion it names, on any kind of page, this section overrides \`.agents/skills/${DESIGN_SKILL}/SKILL.md\` house rules 5 and 8, its section 1's tech-only list, section 5's motion checks and section 6 Never, and the Never list in its \`references/motion.md\`. \`consistency.mjs\` findings for tilt, scroll-reveal, scroll-linked or hover-move on this motion are expected: keep the motion.`,
          ]),
        ])),
    "## Mood",
    "",
    direction.mood,
    "",
  ].join("\n");
};

/** The spec as a file in the app, so briefs point at it instead of repeating it. */
export const specFile = (build: OzoneBuild): string =>
  ["# Spec", "", build.spec, "", "## Done when", "", bullets(build.acceptance), ""].join("\n");

export const planFile = (build: OzoneBuild): string =>
  [
    "# Plan",
    "",
    "Ozone hands these tasks to workers in order and checks each one. Edit the plan through the lead, not here.",
    "",
    ...build.tasks.flatMap((task, index) => [
      `## ${index + 1}. ${task.title} (\`${task.id}\`)`,
      "",
      ...(task.dependsOn.length === 0 ? [] : [`After: ${task.dependsOn.join(", ")}`, ""]),
      task.brief,
      "",
      ...(task.acceptance.length === 0 ? [] : [bullets(task.acceptance), ""]),
    ]),
  ].join("\n");
