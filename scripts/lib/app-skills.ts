/**
 * Agent skills that Ozone copies into the apps it builds, from a pinned upstream commit.
 * Only the listed paths are copied, so a skill's large asset libraries stay out of every app.
 */
export interface AppSkill {
  readonly id: string;
  readonly repository: string;
  readonly commit: string;
  /** The skill's folder in the upstream repository. */
  readonly root: string;
  /** Files and folders under `root` to copy. */
  readonly include: ReadonlyArray<string>;
  /** Files elsewhere in the repository, such as its licence, copied into the skill's folder. */
  readonly extras?: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

export const APP_SKILLS_DIR = "packages/ozone-templates/skills";

export const appSkills: ReadonlyArray<AppSkill> = [
  {
    id: "design-taste-frontend",
    repository: "https://github.com/Leonxlnx/taste-skill.git",
    commit: "f6b76575f949707b4e3c37cd86cb44b0b98643e8",
    root: "skills/taste-skill",
    include: [
      "SKILL.md",
      "references",
      "library",
      "scripts/start.mjs",
      "scripts/consistency.mjs",
      "scripts/shoot.mjs",
      "scripts/perf.mjs",
      "scripts/photos.mjs",
      "scripts/icons.mjs",
      // The only asset files those scripts load; the rest of the 37 MB library stays upstream.
      "assets/effects/fx.js",
      "assets/photos/photos.json",
      "assets/icons/index.json",
    ],
    extras: [{ from: "LICENSE", to: "LICENSE" }],
  },
  {
    id: "frontend-design",
    repository: "https://github.com/anthropics/skills.git",
    commit: "e4bb5d960d87126ff3b3a8af1a104b7db67560ba",
    root: "skills/frontend-design",
    include: ["SKILL.md", "LICENSE.txt"],
  },
];
