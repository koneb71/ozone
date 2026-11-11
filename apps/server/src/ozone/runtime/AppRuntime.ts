import {
  OzoneAppError,
  type OzoneDockerStatus,
  type OzoneRuntimeActInput,
  type OzoneRuntimeLogsInput,
  type OzoneRuntimeLogsResult,
  type OzoneRuntimePhase,
  type OzoneRuntimeService,
  type OzoneRuntimeStatus,
  type ProjectId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as FiberMap from "effect/FiberMap";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";

import * as AppRegistry from "../apps/AppRegistry.ts";
import * as AppData from "../data/AppData.ts";
import * as AppCompose from "./AppCompose.ts";
import * as DockerCli from "./DockerCli.ts";

export interface AppExecInput {
  readonly projectId: ProjectId;
  readonly command: string;
  readonly timeout?: Duration.Input;
}

export interface AppExecResult {
  readonly code: number | null;
  readonly output: string;
  readonly timedOut: boolean;
}

export class AppRuntime extends Context.Service<
  AppRuntime,
  {
    readonly docker: Effect.Effect<OzoneDockerStatus>;
    readonly status: (projectId: ProjectId) => Effect.Effect<OzoneRuntimeStatus, OzoneAppError>;
    /** Returns as soon as the action is under way; `changes` reports how it ends. */
    readonly act: (input: OzoneRuntimeActInput) => Effect.Effect<OzoneRuntimeStatus, OzoneAppError>;
    readonly logs: (
      input: OzoneRuntimeLogsInput,
    ) => Effect.Effect<OzoneRuntimeLogsResult, OzoneAppError>;
    /** Runs a shell command inside the app's container, where its dependencies live. */
    readonly exec: (input: AppExecInput) => Effect.Effect<AppExecResult, OzoneAppError>;
    /** The current status, then each change to it. */
    readonly changes: (projectId: ProjectId) => Stream.Stream<OzoneRuntimeStatus, OzoneAppError>;
  }
>()("t3/ozone/runtime/AppRuntime") {}

const START_TIMEOUT = Duration.minutes(30);
const STATUS_POLL_INTERVAL = Duration.seconds(3);
// Shorter than the poll, so watchers of many apps share one listing per tick.
const CONTAINER_LIST_TTL = Duration.seconds(2);
const DOCKER_CHECK_TTL = Duration.seconds(5);
const FAILURE_TAIL_CHARS = 1_200;

/** Compose labels every container with its project and service, so one listing covers all apps. */
const CONTAINER_LIST_ARGS = [
  "ps",
  "--all",
  "--filter",
  "label=com.docker.compose.project",
  "--format",
  '{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}\t{{.State}}\t{{.Status}}',
] as const;

export interface AppContainer {
  readonly project: string;
  readonly service: string;
  readonly state: string;
  readonly health: OzoneRuntimeService["health"];
}

/** Docker reports health only inside the status text: `Up 2 minutes (healthy)`. */
const healthIn = (status: string): OzoneRuntimeService["health"] => {
  if (status.includes("(healthy)")) return "healthy";
  if (status.includes("(unhealthy)")) return "unhealthy";
  if (status.includes("(health: starting)")) return "starting";
  return null;
};

export const parseContainerList = (stdout: string): ReadonlyArray<AppContainer> =>
  stdout.split("\n").flatMap((line) => {
    const [project, service, state, status] = line.split("\t");
    if (!project || !service || state === undefined) return [];
    return [{ project, service, state: state.trim(), health: healthIn(status ?? "") }];
  });

export interface RuntimeOperation {
  readonly state: "starting" | "failed";
  readonly message: string;
}

/** What the user is told about the app, from Docker's container list and Ozone's own action. */
export const derivePhase = (input: {
  readonly appService: string;
  readonly services: ReadonlyArray<OzoneRuntimeService>;
  readonly operation: RuntimeOperation | undefined;
}): { readonly phase: OzoneRuntimePhase; readonly message: string | null } => {
  if (input.operation?.state === "starting") {
    return { phase: "starting", message: input.operation.message };
  }
  const app = input.services.find((service) => service.service === input.appService);
  if (app === undefined || app.state !== "running") {
    return input.operation?.state === "failed"
      ? { phase: "failed", message: input.operation.message }
      : { phase: "stopped", message: null };
  }
  if (app.health === "unhealthy") {
    return { phase: "unhealthy", message: "The app is running but its health check is failing." };
  }
  if (app.health === "starting") {
    return { phase: "starting", message: "Installing dependencies and starting the app." };
  }
  return { phase: "running", message: null };
};

const tail = (text: string, limit: number) =>
  text.length <= limit ? text : text.slice(text.length - limit);

const sameStatus = (previous: OzoneRuntimeStatus, next: OzoneRuntimeStatus) =>
  previous.phase === next.phase &&
  previous.message === next.message &&
  previous.url === next.url &&
  previous.services.length === next.services.length &&
  previous.services.every((service, index) => {
    const other = next.services[index];
    return (
      other !== undefined &&
      service.service === other.service &&
      service.state === other.state &&
      service.health === other.health
    );
  });

export const make = Effect.gen(function* () {
  const docker = yield* DockerCli.DockerCli;
  const compose = yield* AppCompose.AppCompose;
  const data = yield* AppData.AppData;
  const registry = yield* AppRegistry.AppRegistry;

  const operations = yield* Ref.make<ReadonlyMap<ProjectId, RuntimeOperation>>(new Map());
  const starts = yield* FiberMap.make<ProjectId>();
  const changed = yield* PubSub.sliding<ProjectId>(64);

  const dockerStatus = yield* Effect.cachedWithTTL(
    docker
      .run({ args: ["version", "--format", "{{.Server.Version}}"], timeout: Duration.seconds(10) })
      .pipe(
        Effect.map((output): OzoneDockerStatus =>
          output.code === 0 && output.stdout.trim().length > 0
            ? { available: true, version: output.stdout.trim(), message: null }
            : {
                available: false,
                version: null,
                message: "Docker is installed but not running. Start Docker, then try again.",
              },
        ),
        Effect.catch((error) =>
          Effect.succeed<OzoneDockerStatus>({
            available: false,
            version: null,
            message: `${error.detail} Ozone runs every app with Docker Compose.`,
          }),
        ),
      ),
    DOCKER_CHECK_TTL,
  );

  const [containers, forgetContainers] = yield* Effect.cachedInvalidateWithTTL(
    docker.run({ args: CONTAINER_LIST_ARGS, timeout: Duration.seconds(20) }).pipe(
      Effect.map((output) => (output.code === 0 ? parseContainerList(output.stdout) : [])),
      Effect.orElseSucceed((): ReadonlyArray<AppContainer> => []),
    ),
    CONTAINER_LIST_TTL,
  );

  const setOperation = (projectId: ProjectId, operation: RuntimeOperation | undefined) =>
    Ref.update(operations, (current) => {
      const next = new Map(current);
      if (operation === undefined) next.delete(projectId);
      else next.set(projectId, operation);
      return next;
    }).pipe(
      Effect.andThen(forgetContainers),
      Effect.andThen(PubSub.publish(changed, projectId)),
      Effect.asVoid,
    );

  const unavailable = (detail: string) =>
    new OzoneAppError({ reason: "docker_unavailable", message: detail });

  const statusOf = Effect.fn("AppRuntime.statusOf")(function* (resolved: AppRegistry.ResolvedApp) {
    const projectId = resolved.app.projectId;
    const updatedAt = DateTime.formatIso(yield* DateTime.now);
    const availability = yield* dockerStatus;
    if (!availability.available) {
      return {
        projectId,
        phase: "unavailable",
        url: null,
        services: [],
        message: availability.message,
        updatedAt,
      } satisfies OzoneRuntimeStatus;
    }
    const dataServices = new Set(resolved.manifest.data.services.map((entry) => entry.service));
    const services = (yield* containers)
      .filter((container) => container.project === resolved.app.slug)
      .map((container): OzoneRuntimeService => ({
        service: container.service,
        state: container.state,
        health: container.health,
        data: dataServices.has(container.service),
      }))
      .toSorted((left, right) => left.service.localeCompare(right.service));
    const derived = derivePhase({
      appService: resolved.manifest.runtime.appService,
      services,
      operation: (yield* Ref.get(operations)).get(projectId),
    });
    return {
      projectId,
      phase: derived.phase,
      url: derived.phase === "running" ? `http://localhost:${resolved.app.port}` : null,
      services,
      message: derived.message,
      updatedAt,
    } satisfies OzoneRuntimeStatus;
  });

  /** A new action replaces a start still in flight, once Docker's own process has gone. */
  const supersede = (projectId: ProjectId) =>
    FiberMap.get(starts, projectId).pipe(
      Effect.flatMap(Option.match({ onNone: () => Effect.void, onSome: Fiber.interrupt })),
    );

  /** Builds and starts in the background: a first start pulls images and installs dependencies. */
  const start = Effect.fn("AppRuntime.start")(function* (
    resolved: AppRegistry.ResolvedApp,
    args: ReadonlyArray<string>,
    message: string,
  ) {
    const projectId = resolved.app.projectId;
    yield* supersede(projectId);
    yield* setOperation(projectId, { state: "starting", message });
    yield* FiberMap.run(
      starts,
      projectId,
      compose.run(resolved, args, { timeout: START_TIMEOUT }).pipe(
        Effect.flatMap((output) =>
          output.code === 0
            ? setOperation(projectId, undefined)
            : setOperation(projectId, {
                state: "failed",
                message: output.timedOut
                  ? "Docker took too long to start the app."
                  : tail(output.stderr.trim() || output.stdout.trim(), FAILURE_TAIL_CHARS),
              }),
        ),
        Effect.catch((error) =>
          setOperation(projectId, { state: "failed", message: error.message }),
        ),
      ),
    );
  });

  const settle = Effect.fn("AppRuntime.settle")(function* (
    resolved: AppRegistry.ResolvedApp,
    args: ReadonlyArray<string>,
    failure: string,
  ) {
    const projectId = resolved.app.projectId;
    yield* supersede(projectId);
    const output = yield* compose.run(resolved, args, { timeout: Duration.minutes(3) });
    yield* setOperation(
      projectId,
      output.code === 0
        ? undefined
        : { state: "failed", message: tail(output.stderr.trim() || failure, FAILURE_TAIL_CHARS) },
    );
  });

  return AppRuntime.of({
    docker: dockerStatus,
    status: Effect.fn("AppRuntime.status")(function* (projectId) {
      return yield* statusOf(yield* registry.resolve(projectId));
    }),
    act: Effect.fn("AppRuntime.act")(function* (input) {
      const resolved = yield* registry.resolve(input.projectId);
      const availability = yield* dockerStatus;
      if (!availability.available) {
        return yield* unavailable(availability.message ?? "Docker is not available.");
      }
      switch (input.action) {
        case "up":
          if (yield* FiberMap.has(starts, input.projectId)) break;
          yield* start(resolved, ["up", "--detach", "--build"], "Building and starting the app.");
          break;
        case "rebuild":
          // Recreating containers keeps the volumes; the snapshot is for what a new image might do.
          yield* data
            .snapshot({ projectId: input.projectId, reason: "before-rebuild" })
            .pipe(Effect.ignore);
          yield* start(
            resolved,
            ["up", "--detach", "--build", "--force-recreate"],
            "Rebuilding the app. Its data is kept.",
          );
          break;
        case "stop":
          yield* settle(resolved, ["stop"], "Docker could not stop the app.");
          break;
        case "restart":
          yield* settle(resolved, ["restart"], "Docker could not restart the app.");
          break;
      }
      return yield* statusOf(resolved);
    }),
    logs: Effect.fn("AppRuntime.logs")(function* (input) {
      const resolved = yield* registry.resolve(input.projectId);
      const output = yield* compose.run(
        resolved,
        [
          "logs",
          "--no-color",
          "--tail",
          String(input.tail ?? 200),
          ...(input.service === undefined ? [] : [input.service]),
        ],
        { timeout: Duration.seconds(30), maxOutputBytes: 512 * 1024 },
      );
      return { text: output.stdout.length > 0 ? output.stdout : output.stderr };
    }),
    exec: Effect.fn("AppRuntime.exec")(function* (input) {
      const resolved = yield* registry.resolve(input.projectId);
      const output = yield* compose.run(
        resolved,
        ["exec", "-T", resolved.manifest.runtime.appService, "sh", "-lc", input.command],
        { timeout: input.timeout ?? Duration.minutes(10), maxOutputBytes: 512 * 1024 },
      );
      return {
        code: output.code,
        output: [output.stdout, output.stderr].filter((part) => part.length > 0).join("\n"),
        timedOut: output.timedOut,
      };
    }),
    changes: (projectId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          const resolved = yield* registry.resolve(projectId);
          // Subscribed before the first status is read, so no change is missed in between.
          const signals = yield* PubSub.subscribe(changed);
          return Stream.merge(
            Stream.fromSubscription(signals).pipe(Stream.filter((id) => id === projectId)),
            Stream.tick(STATUS_POLL_INTERVAL),
          ).pipe(
            Stream.mapEffect(() => statusOf(resolved)),
            Stream.changesWith(sameStatus),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(AppRuntime, make);
