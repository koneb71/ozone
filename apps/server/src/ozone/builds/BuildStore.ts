import { OzoneAppError, OzoneBuild, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as PubSub from "effect/PubSub";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as Stream from "effect/Stream";
import { storageFailed } from "../errors.ts";

/** One build per lead thread, stored whole: it is small, and always read and written as one. */
export class BuildStore extends Context.Service<
  BuildStore,
  {
    readonly get: (threadId: ThreadId) => Effect.Effect<OzoneBuild | null, OzoneAppError>;
    /** Every build, for the work a restart has to pick up again. */
    readonly list: Effect.Effect<ReadonlyArray<OzoneBuild>, OzoneAppError>;
    /**
     * Reads, changes and saves a build as one step, so a tool call and a check that ends at the
     * same moment never undo each other. `change` returns what to hand back and the build to
     * save, or null to save nothing.
     */
    readonly modify: <A>(
      threadId: ThreadId,
      change: (current: OzoneBuild | null) => readonly [A, OzoneBuild | null],
    ) => Effect.Effect<A, OzoneAppError>;
    /** The build as it is now, then each saved change. */
    readonly changes: (threadId: ThreadId) => Stream.Stream<OzoneBuild | null, OzoneAppError>;
    /** Every build as it is saved, from the moment of subscribing. */
    readonly saves: Stream.Stream<OzoneBuild>;
  }
>()("t3/ozone/builds/BuildStore") {}

// Created here for the same reason as `ozone_apps`: upstream's migration list is not Ozone's.
const CREATE_BUILDS_TABLE = `CREATE TABLE IF NOT EXISTS ozone_builds (
  thread_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  build_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const BuildJson = Schema.fromJsonString(OzoneBuild);
const encodeBuild = Schema.encodeEffect(BuildJson);

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql.unsafe(CREATE_BUILDS_TABLE).pipe(Effect.orDie);
  const saved = yield* PubSub.sliding<OzoneBuild>(64);
  // One writer at a time for every build: a write is a few milliseconds, and builds are few.
  const writing = yield* Semaphore.make(1);

  const select = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Schema.Struct({ build: BuildJson }),
    execute: (threadId) =>
      sql`SELECT build_json AS "build" FROM ozone_builds WHERE thread_id = ${threadId}`,
  });

  const selectAll = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ build: BuildJson }),
    execute: () => sql`SELECT build_json AS "build" FROM ozone_builds`,
  });

  const get = Effect.fn("BuildStore.get")(function* (threadId: ThreadId) {
    const row = yield* select(threadId).pipe(Effect.mapError(storageFailed("read the build")));
    return Option.isSome(row) ? row.value.build : null;
  });

  const put = Effect.fn("BuildStore.put")(function* (build: OzoneBuild) {
    const json = yield* encodeBuild(build).pipe(Effect.mapError(storageFailed("write the build")));
    yield* sql`
      INSERT INTO ozone_builds (thread_id, project_id, build_json, updated_at)
      VALUES (${build.threadId}, ${build.projectId}, ${json}, ${build.updatedAt})
      ON CONFLICT (thread_id) DO UPDATE SET
        build_json = excluded.build_json,
        updated_at = excluded.updated_at
    `.pipe(Effect.mapError(storageFailed("save the build")));
    yield* PubSub.publish(saved, build);
  });

  return BuildStore.of({
    get,
    list: selectAll(undefined).pipe(
      Effect.map((rows) => rows.map((row) => row.build)),
      Effect.mapError(storageFailed("read the builds")),
    ),
    modify: Effect.fn("BuildStore.modify")((threadId, change) =>
      writing.withPermits(1)(
        Effect.gen(function* () {
          const [result, next] = change(yield* get(threadId));
          if (next !== null) yield* put(next);
          return result;
        }),
      ),
    ),
    saves: Stream.fromPubSub(saved),
    changes: (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribed before the read, so a save in between is not missed.
          const updates = yield* PubSub.subscribe(saved);
          const current = yield* get(threadId);
          return Stream.concat(
            Stream.make(current),
            Stream.fromSubscription(updates).pipe(
              Stream.filter((build) => build.threadId === threadId),
            ),
          );
        }),
      ),
  });
});

export const layer = Layer.effect(BuildStore, make);
