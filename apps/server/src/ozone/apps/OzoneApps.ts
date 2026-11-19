import {
  CommandId,
  DEFAULT_OZONE_APP_SETTINGS,
  OZONE_MANIFEST_FILE_NAME,
  OzoneApp,
  OzoneAppError,
  OzoneAppManifest,
  ProjectId,
  type OzoneAppConfigureInput,
  type OzoneAppCreateInput,
  type OzoneAppCreateResult,
  type OzoneAppDeleteInput,
  type OzoneAppDeleteResult,
  type OzoneAppRestoreInput,
  type OzoneAppsListResult,
  type OzoneDeletedApp,
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
import * as Schema from "effect/Schema";
import * as Scope from "effect/Scope";
import * as Semaphore from "effect/Semaphore";

import * as ServerConfig from "../../config.ts";
import { expandHomePath } from "../../os-jank.ts";
import * as ManagedProjectFolders from "../../project/ManagedProjectFolders.ts";
import * as ProjectService from "../../project/ProjectService.ts";
import * as ServerSettings from "../../serverSettings.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as AppData from "../data/AppData.ts";
import * as AppDeploy from "../deploy/AppDeploy.ts";
import * as AppRuntime from "../runtime/AppRuntime.ts";
import { failed } from "../errors.ts";
import * as AppRegistry from "./AppRegistry.ts";
import { appSlug, safeAppName, scaffold } from "./AppScaffolder.ts";
import {
  DELETED_RECORD_FILE,
  type DeletedRecord,
  decodeDeletedRecord,
  encodeDeletedRecord,
} from "./deletedApp.ts";
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
    /**
     * Brings a deleted app back under its old name: a project for its folder, its settings, and
     * its last snapshot loaded before it starts. Its threads are not brought back.
     */
    readonly restore: (
      input: OzoneAppRestoreInput,
    ) => Effect.Effect<OzoneAppCreateResult, OzoneAppError>;
    readonly configure: (input: OzoneAppConfigureInput) => Effect.Effect<OzoneApp, OzoneAppError>;
  }
>()("t3/ozone/apps/OzoneApps") {}

/** Each app keeps one host port for life, so its preview URL and auth callback stay valid. */
const APP_PORT_RANGE = { first: 41_000, last: 41_999 } as const;
const FALLBACK_USER_ID = 1_000;

/** Whose data a snapshot holds, which is all an app deleted without a record left of itself. */
const decodeSnapshotOwner = Schema.decodeUnknownEffect(
  Schema.fromJsonString(Schema.Struct({ snapshot: Schema.Struct({ projectId: ProjectId }) })),
);
const decodeManifest = Schema.decodeUnknownEffect(Schema.fromJsonString(OzoneAppManifest));

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
  const deploys = yield* AppDeploy.AppDeploy;
  const config = yield* ServerConfig.ServerConfig;
  const serverSettings = yield* ServerSettings.ServerSettingsService;
  const hostUserId = yield* HostProcess.UserId;
  const scope = yield* Scope.Scope;
  // One at a time, so two new apps can never be given the same port.
  const creating = yield* Semaphore.make(1);

  /** The folder the user chose for their apps, or null for Ozone's own. */
  const appsDirectory = serverSettings.getSettings.pipe(
    Effect.mapError(() => failed("Ozone could not read its settings.")),
    Effect.flatMap(({ appsDirectory: chosen }) =>
      chosen === ""
        ? Effect.succeed(null)
        : expandHomePath(chosen).pipe(Effect.provideService(Path.Path, path)),
    ),
  );

  const freePort = Effect.fn("OzoneApps.freePort")(function* (taken: ReadonlySet<number>) {
    for (let port = APP_PORT_RANGE.first; port <= APP_PORT_RANGE.last; port++) {
      if (!taken.has(port) && (yield* net.isPortAvailableOnLoopback(port))) return port;
    }
    return yield* failed("No free port is left for a new app on this machine.");
  });

  /**
   * Every passed task is a commit, and History and deploys read them. On a machine where Git has
   * no identity, the app's own repository gets one, and nothing outside it is configured.
   */
  const ensureIdentity = Effect.fn("OzoneApps.ensureIdentity")(function* (workspaceRoot: string) {
    const config = (args: ReadonlyArray<string>) =>
      git.execute({
        operation: "OzoneApps.identity",
        cwd: workspaceRoot,
        args: ["config", ...args],
        allowNonZeroExit: true,
        timeoutMs: 10_000,
      });
    const email = yield* config(["user.email"]);
    if (Number(email.exitCode) === 0 && email.stdout.trim().length > 0) return;
    yield* config(["--local", "user.name", "Ozone"]);
    yield* config(["--local", "user.email", "ozone@localhost"]);
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
        // A failed commit still leaves a working app; the first passed task commits everything.
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
    const parent = yield* appsDirectory;
    const { projectId, workspaceRoot } = yield* folders
      .createNamedProject({ name, ...(parent === null ? {} : { parent }) })
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
      yield* ensureIdentity(workspaceRoot).pipe(Effect.ignore);
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

  const backupsOf = (slug: string) => AppData.backupFolder(path, config.stateDir, slug);
  const recordPathOf = (slug: string) => path.join(backupsOf(slug), DELETED_RECORD_FILE);

  /** An app deleted before Ozone kept a record, pieced together from what it left behind. */
  const legacyRecord = Effect.fn("OzoneApps.legacyRecord")(function* (slug: string) {
    const names = yield* fs.readDirectory(backupsOf(slug)).pipe(Effect.orElseSucceed(() => []));
    const owners = yield* Effect.forEach(names.toSorted().toReversed(), (name) =>
      fs
        .readFileString(path.join(backupsOf(slug), name, "snapshot.json"))
        .pipe(Effect.flatMap(decodeSnapshotOwner), Effect.option),
    );
    const owner = owners.flatMap(Option.toArray)[0]?.snapshot.projectId;
    if (owner === undefined) return null;
    const project = Option.getOrNull(
      yield* projects
        .getById(owner, { includeDeleted: true })
        .pipe(Effect.orElseSucceed(() => Option.none())),
    );
    if (project === null) return null;
    const environment = yield* fs
      .readFileString(path.join(project.workspaceRoot, ".env"))
      .pipe(Effect.orElseSucceed(() => ""));
    const port = Number(/^OZONE_APP_PORT=(\d+)$/m.exec(environment)?.[1]);
    const manifest = yield* fs
      .readFileString(path.join(project.workspaceRoot, OZONE_MANIFEST_FILE_NAME))
      .pipe(Effect.flatMap(decodeManifest), Effect.option);
    if (!Number.isInteger(port) || Option.isNone(manifest)) return null;
    return {
      app: {
        projectId: owner,
        slug,
        name: project.title,
        templateId: manifest.value.template ?? DEFAULT_TEMPLATE_ID,
        port,
        createdAt: project.createdAt,
        settings: DEFAULT_OZONE_APP_SETTINGS,
      },
      workspaceRoot: project.workspaceRoot,
      deletedAt: project.deletedAt,
    } satisfies DeletedRecord;
  });

  /** What is left of a deleted app, when enough is left to bring it back. */
  const deletedRecord = Effect.fn("OzoneApps.deletedRecord")(function* (slug: string) {
    const recorded = yield* fs
      .readFileString(recordPathOf(slug))
      .pipe(Effect.flatMap(decodeDeletedRecord), Effect.option);
    const record = Option.isSome(recorded) ? recorded.value : yield* legacyRecord(slug);
    if (record === null) return null;
    const hasManifest = yield* fs
      .exists(path.join(record.workspaceRoot, OZONE_MANIFEST_FILE_NAME))
      .pipe(Effect.orElseSucceed(() => false));
    return hasManifest ? record : null;
  });

  const deletedApps = Effect.fn("OzoneApps.deletedApps")(function* (
    registered: ReadonlyArray<OzoneApp>,
  ) {
    const slugs = yield* fs
      .readDirectory(path.dirname(backupsOf("any")))
      .pipe(Effect.orElseSucceed(() => []));
    const records = yield* Effect.forEach(
      slugs.filter((slug) => !registered.some((app) => app.slug === slug)),
      deletedRecord,
    );
    return records
      .flatMap((record): ReadonlyArray<OzoneDeletedApp> =>
        record === null
          ? []
          : [
              {
                slug: record.app.slug,
                name: record.app.name,
                templateId: record.app.templateId,
                workspaceRoot: record.workspaceRoot,
                deletedAt: record.deletedAt,
              },
            ],
      )
      .toSorted((left, right) => (right.deletedAt ?? "").localeCompare(left.deletedAt ?? ""));
  });

  const restoreOne = Effect.fn("OzoneApps.restoreOne")(function* (slug: string) {
    const registered = yield* registry.list;
    if (registered.some((app) => app.slug === slug)) {
      return yield* failed("That app is not deleted.");
    }
    const record = yield* deletedRecord(slug);
    if (record === null) {
      return yield* failed(
        "Not enough is left of that app to bring it back: its folder or its record is gone.",
      );
    }
    const id = yield* random
      .uuidV4()
      .pipe(Effect.mapError(() => failed("Could not name the app's project.")));
    // A project the person already made for the folder by hand is used as it is.
    const { project } = yield* projects
      .bootstrap({
        commandId: CommandId.make(`ozone-app-restore:${id}`),
        projectId: ProjectId.make(id),
        title: record.app.name,
        workspaceRoot: record.workspaceRoot,
      })
      .pipe(Effect.mapError((error) => failed(error.message)));
    const taken = new Set(registered.map((app) => app.port));
    const keepsPort =
      !taken.has(record.app.port) && (yield* net.isPortAvailableOnLoopback(record.app.port));
    const port = keepsPort ? record.app.port : yield* freePort(taken);
    if (!keepsPort) {
      const environmentPath = path.join(record.workspaceRoot, ".env");
      yield* fs.readFileString(environmentPath).pipe(
        Effect.flatMap((text) =>
          fs.writeFileString(
            environmentPath,
            text.replace(/^OZONE_APP_PORT=.*$/m, `OZONE_APP_PORT=${port}`),
          ),
        ),
        Effect.mapError(() => failed("Could not give the app a new port in its .env file.")),
      );
    }
    // The same slug, so its settings, its snapshots and its deploy are its own again.
    const app: OzoneApp = { ...record.app, projectId: project.id, port };
    yield* registry.register(app);
    // Before it first starts, so its startup migration runs on the data it had.
    yield* data
      .revive(project.id)
      .pipe(Effect.tapError(() => registry.unregister(project.id).pipe(Effect.ignore)));
    yield* fs.remove(recordPathOf(slug)).pipe(Effect.ignore);
    yield* runtime
      .act({ projectId: project.id, action: "up" })
      .pipe(Effect.ignore, Effect.forkIn(scope));
    return { app, workspaceRoot: record.workspaceRoot };
  });

  const remove = Effect.fn("OzoneApps.removeApp")(function* (projectId: ProjectId) {
    const { app, workspaceRoot } = yield* registry.resolve(projectId);
    // A running deployment is the person's to stop or delete first. One left stopped keeps its data,
    // and stays listed with the deleted app in Settings, Servers, where it can be deleted later.
    const production = yield* deploys.status(projectId);
    if (production.state === "running" || production.state === "deploying") {
      return yield* failed(
        `${app.name} is deployed and running. Stop it or delete the deployment under Deploy first.`,
      );
    }
    const { snapshot } = yield* data.remove(projectId);
    yield* encodeDeletedRecord({
      app,
      workspaceRoot,
      deletedAt: DateTime.formatIso(yield* DateTime.now),
    }).pipe(
      Effect.flatMap((json) =>
        fs
          .makeDirectory(backupsOf(app.slug), { recursive: true })
          .pipe(Effect.andThen(fs.writeFileString(recordPathOf(app.slug), json))),
      ),
      // Without it the app can still be pieced together from its snapshot.
      Effect.ignore,
    );
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
      const apps = yield* registry.list;
      return {
        apps,
        templates: TEMPLATES,
        docker: yield* runtime.docker,
        deleted: yield* deletedApps(apps),
        defaultDirectory: folders.namedProjectsRoot,
      };
    }),
    restore: Effect.fn("OzoneApps.restore")((input) =>
      Effect.forkIn(creating.withPermits(1)(restoreOne(input.slug)), scope).pipe(
        Effect.flatMap(Fiber.join),
      ),
    ),
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
