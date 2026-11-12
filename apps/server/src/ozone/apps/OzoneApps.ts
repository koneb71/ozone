import {
  CommandId,
  DEFAULT_OZONE_APP_SETTINGS,
  OzoneAppError,
  type OzoneApp,
  type OzoneAppConfigureInput,
  type OzoneAppCreateInput,
  type OzoneAppCreateResult,
  type OzoneAppDeleteInput,
  type OzoneAppDeleteResult,
  type OzoneAppsListResult,
  type ProjectId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as NetService from "@t3tools/shared/Net";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as Fiber from "effect/Fiber";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AppData from "../data/AppData.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import * as AppRegistry from "./AppRegistry.ts";
import { appSlug, safeAppName, scaffold } from "./AppScaffolder.ts";
import { DEFAULT_TEMPLATE_ID, TEMPLATES, findTemplate, templateFiles } from "./templates.ts";

export class OzoneApps extends Context.Service<
  OzoneApps,
  {
    readonly list: Effect.Effect<OzoneAppsListResult, OzoneAppError>;
    /** Creates the project, fills it from a template, and starts its containers. */
    readonly create: (
      input: OzoneAppCreateInput,
    ) => Effect.Effect<OzoneAppCreateResult, OzoneAppError>;
    /**
     * Removes the app's containers, its data and its project. A snapshot is taken first and kept,
     * and the folder stays on disk. Only a person may ask for this.
     */
    readonly remove: (
      input: OzoneAppDeleteInput,
    ) => Effect.Effect<OzoneAppDeleteResult, OzoneAppError>;
    readonly configure: (input: OzoneAppConfigureInput) => Effect.Effect<OzoneApp, OzoneAppError>;
  }
>()("t3/ozone/apps/OzoneApps") {}

/** Each app keeps one host port for life, so its preview URL and auth callback stay valid. */
const APP_PORT_RANGE = { first: 41_000, last: 41_999 } as const;
const FALLBACK_USER_ID = 1_000;

const failed = (message: string) => new OzoneAppError({ reason: "failed", message });

export const make = Effect.gen(function* () {
  const registry = yield* AppRegistry.AppRegistry;
  const folders = yield* ManagedProjectFolders.ManagedProjectFolders;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const net = yield* NetService.NetService;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const random = yield* SecureRandom.SecureRandom;
  const runtime = yield* AppRuntime.AppRuntime;
  const data = yield* AppData.AppData;
  const projects = yield* ProjectService.ProjectService;
  const hostUserId = yield* HostProcess.UserId;
  const scope = yield* Scope.Scope;
  // One at a time, so two new apps can never be given the same port.
  const creating = yield* Semaphore.make(1);

  const freePort = Effect.fn("OzoneApps.freePort")(function* (taken: ReadonlySet<number>) {
    for (let port = APP_PORT_RANGE.first; port <= APP_PORT_RANGE.last; port++) {
      if (!taken.has(port) && (yield* net.isPortAvailableOnLoopback(port))) return port;
    }
    return yield* failed("No free port is left for a new app on this machine.");
  });

  const commitScaffold = (workspaceRoot: string, templateId: string) =>
    git
      .execute({
        operation: "OzoneApps.add",
        cwd: workspaceRoot,
        args: ["-c", "core.safecrlf=false", "add", "--all"],
        timeoutMs: 30_000,
      })
      .pipe(
        Effect.andThen(
          git.execute({
            operation: "OzoneApps.commit",
            cwd: workspaceRoot,
            args: ["commit", "--message", `Scaffold from the Ozone ${templateId} template`],
            allowNonZeroExit: true,
            timeoutMs: 30_000,
          }),
        ),
        // A machine without a Git identity still gets a working app; the files stay uncommitted.
        Effect.ignore,
      );

  const createOne = Effect.fn("OzoneApps.createOne")(function* (input: OzoneAppCreateInput) {
    const templateId = input.templateId ?? DEFAULT_TEMPLATE_ID;
    if (findTemplate(templateId) === undefined) {
      return yield* new OzoneAppError({
        reason: "unknown_template",
        message: `There is no template called ${templateId}.`,
      });
    }
    // Read before anything is made, so a missing template leaves nothing behind.
    const files = yield* templateFiles(templateId).pipe(
      Effect.provideService(FileSystem.FileSystem, fs),
      Effect.provideService(Path.Path, path),
      Effect.mapError(() =>
        failed(`Ozone could not read its ${templateId} template. Reinstall Ozone.`),
      ),
    );
    const name = safeAppName(input.name);
    const port = yield* freePort(new Set((yield* registry.list).map((app) => app.port)));
    const { projectId, workspaceRoot } = yield* folders
      .createNamedProject({ name })
      .pipe(Effect.mapError((error) => failed(error.message)));
    // From here a failure takes back the project and the folder made for it.
    const undo = Effect.all(
      [
        projects
          .delete({
            commandId: CommandId.make(`ozone-app-undo:${projectId}`),
            projectId,
            force: true,
          })
          .pipe(Effect.ignore),
        fs.remove(workspaceRoot, { recursive: true }).pipe(Effect.ignore),
      ],
      { discard: true },
    );

    const app = yield* Effect.gen(function* () {
      const owner = yield* fs.stat(workspaceRoot).pipe(Effect.option);
      const userId = Option.getOrElse(
        Option.flatMap(owner, (info) => info.uid),
        () => hostUserId ?? FALLBACK_USER_ID,
      );
      const groupId = Option.getOrElse(
        Option.flatMap(owner, (info) => info.gid),
        () => userId,
      );
      const authSecret = yield* Effect.all([random.uuidV4(), random.uuidV4()]).pipe(
        Effect.map((parts) => parts.join("").replaceAll("-", "")),
        Effect.mapError(() => failed("Could not generate the app's secret.")),
      );
      const slug = appSlug(path.basename(workspaceRoot), projectId);

      yield* scaffold({
        files,
        workspaceRoot,
        name,
        slug,
        port,
        userId,
        groupId,
        authSecret,
      }).pipe(
        Effect.provideService(FileSystem.FileSystem, fs),
        Effect.provideService(Path.Path, path),
        Effect.mapError(() => failed("Could not write the template into the new app.")),
      );
      yield* commitScaffold(workspaceRoot, templateId);

      const app: OzoneApp = {
        projectId,
        slug,
        name,
        templateId,
        port,
        createdAt: DateTime.formatIso(yield* DateTime.now),
        settings: { ...DEFAULT_OZONE_APP_SETTINGS, ...input.settings },
      };
      yield* registry.register(app);
      return app;
    }).pipe(Effect.onExit((exit) => (Exit.isSuccess(exit) ? Effect.void : undo)));
    // Starting takes minutes on a first run (image pulls, npm install); the caller watches it.
    yield* runtime.act({ projectId, action: "up" }).pipe(Effect.ignore, Effect.forkIn(scope));
    return { app, workspaceRoot };
  });

  const remove = Effect.fn("OzoneApps.removeApp")(function* (projectId: ProjectId) {
    const { workspaceRoot } = yield* registry.resolve(projectId);
    const { snapshot } = yield* data.remove(projectId);
    yield* registry.unregister(projectId);
    // The data is gone by now, so a project that cannot be removed is said, not undone.
    yield* projects
      .delete({
        commandId: CommandId.make(`ozone-app-delete:${projectId}`),
        projectId,
        force: true,
      })
      .pipe(
        Effect.mapError((error) =>
          failed(
            `The app's containers and data are removed, and snapshot ${snapshot.id} is kept. Its project could not be removed: ${error.message} Delete the project from its own menu.`,
          ),
        ),
      );
    return { snapshot, workspaceRoot };
  });

  return OzoneApps.of({
    list: Effect.gen(function* () {
      return {
        apps: yield* registry.list,
        templates: TEMPLATES,
        docker: yield* runtime.docker,
      };
    }),
    create: Effect.fn("OzoneApps.create")((input) => creating.withPermits(1)(createOne(input))),
    configure: Effect.fn("OzoneApps.configure")((input) =>
      registry.configure(input.projectId, input.settings),
    ),
    remove: Effect.fn("OzoneApps.remove")((input) =>
      // Confirmed once, so it runs to its end even if the person's window closes halfway.
      Effect.forkIn(remove(input.projectId), scope).pipe(Effect.flatMap(Fiber.join)),
    ),
  });
});

export const layer = Layer.effect(OzoneApps, make);
