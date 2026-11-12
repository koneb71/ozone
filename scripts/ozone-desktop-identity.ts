/**
 * Ozone's identity on a packaged desktop app. Upstream's build script composes the staged package
 * with T3 Code's names; this rewrites the result in one place, so that script keeps upstream's text
 * and merges cleanly. URL schemes stay upstream's: links made for one app must open in the other.
 */
export const OZONE_DESKTOP_APP_ID = "io.github.koneb71.ozone";
/** What Electron reports as WM_CLASS on Linux; the launcher must name the same. */
export const OZONE_LINUX_WM_CLASS = "io.github.koneb71.Ozone";
const REPOSITORY_URL = "https://github.com/koneb71/ozone";

const rename = (text: string) =>
  text
    .replaceAll("com.t3tools.t3code.metainfo.xml", `${OZONE_DESKTOP_APP_ID}.metainfo.xml`)
    .replaceAll("/usr/share/doc/t3code/", "/usr/share/doc/ozone/")
    .replaceAll("com.t3tools.T3Code", OZONE_LINUX_WM_CLASS)
    .replaceAll("com.t3tools.t3code", OZONE_DESKTOP_APP_ID)
    .replaceAll("T3-Code", "Ozone")
    .replaceAll("T3 Code", "Ozone");

const renameDeep = (value: unknown): unknown => {
  if (typeof value === "string") return rename(value);
  if (Array.isArray(value)) return value.map(renameDeep);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, renameDeep(entry)]),
    );
  }
  return value;
};

interface StagePackage {
  readonly name: string;
  readonly description: string;
  readonly homepage: string;
  readonly author: string;
  readonly build: Record<string, unknown>;
}

/** The staged `package.json` electron-builder reads, as Ozone's. */
export function ozoneStagePackage<T extends StagePackage>(stage: T): T {
  const renamed = renameDeep(stage) as T;
  const linux = renamed.build.linux;
  return {
    ...renamed,
    name: "ozone",
    description:
      "Ozone builds apps from a description: it creates the app from a tested template, runs it with Docker Compose, hands the work to coding agents and checks every step itself.",
    homepage: REPOSITORY_URL,
    author: "Ozone",
    build: {
      ...renamed.build,
      ...(linux !== null && typeof linux === "object"
        ? {
            linux: {
              ...linux,
              executableName: "ozone",
              synopsis: "Describe an app and watch it get built",
              maintainer: "Ozone <koneb71@users.noreply.github.com>",
            },
          }
        : {}),
    },
  };
}
