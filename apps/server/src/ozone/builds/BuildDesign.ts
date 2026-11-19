import {
  type OzoneAppError,
  type OzoneDesignDirection,
  OzoneDesignProposal,
  type OzoneDesignProposeInput,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as PubSub from "effect/PubSub";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as SqlClient from "effect/sql/SqlClient";
import * as SqlSchema from "effect/sql/SqlSchema";
import * as Stream from "effect/Stream";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";
import * as AppRegistry from "../apps/AppRegistry.ts";
import { PAGE_TEMPLATES, type TemplateFile, templateFiles } from "../apps/templates.ts";
import { failed, storageFailed } from "../errors.ts";
import { DESIGN_FILE, designFile, NO_PAGES, WAKE } from "./briefs.ts";
import * as BuildWake from "./BuildWake.ts";
import * as DesignDeal from "./designDeal.ts";

/**
 * Design directions a lead offers before it plans, kept until the person answers. Ozone writes
 * the pick to DESIGN.md itself, so a lead in plan mode, which cannot write files, still gets it.
 */
export class BuildDesign extends Context.Service<
  BuildDesign,
  {
    readonly pending: (
      threadId: ThreadId,
    ) => Effect.Effect<OzoneDesignProposal | null, OzoneAppError>;
    /** The directions as they are now, then each change. */
    readonly changes: (
      threadId: ThreadId,
    ) => Stream.Stream<OzoneDesignProposal | null, OzoneAppError>;
    /**
     * Deals a seed per direction from Ozone's own taste library, away from this thread's last
     * deal, and copies each dealt skill into the app when it is missing. Stores nothing.
     */
    readonly deal: (
      threadId: ThreadId,
      request: Pick<OzoneDesignProposeInput, "kind" | "trade">,
    ) => Effect.Effect<ReadonlyArray<DesignDeal.DesignSeed>, OzoneAppError>;
    /** Replaces any directions still waiting. */
    readonly propose: (
      threadId: ThreadId,
      directions: ReadonlyArray<OzoneDesignDirection>,
    ) => Effect.Effect<void, OzoneAppError>;
    /**
     * Writes the picked direction to DESIGN.md, or for null turns the app's "Let me pick the
     * design" off, then wakes the lead. Does nothing when no directions wait.
     */
    readonly answer: (
      threadId: ThreadId,
      pick: number | null,
    ) => Effect.Effect<void, OzoneAppError>;
  }
>()("t3/ozone/builds/BuildDesign") {}

// Created here for the same reason as `ozone_builds`: upstream's migration list is not Ozone's.
const CREATE_TABLE = `CREATE TABLE IF NOT EXISTS ozone_design_proposals (
  thread_id TEXT PRIMARY KEY,
  proposal_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
)`;

const ProposalJson = Schema.fromJsonString(OzoneDesignProposal);
const encodeProposal = Schema.encodeEffect(ProposalJson);

interface Change {
  readonly threadId: ThreadId;
  readonly proposal: OzoneDesignProposal | null;
}

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const registry = yield* AppRegistry.AppRegistry;
  const wake = yield* BuildWake.BuildWake;
  yield* sql.unsafe(CREATE_TABLE).pipe(Effect.orDie);
  const changed = yield* PubSub.sliding<Change>(64);
  // Two windows can answer at once: the first answer wins and the second finds nothing waiting.
  const writing = yield* Semaphore.make(1);

  const select = SqlSchema.findOneOption({
    Request: Schema.String,
    Result: Schema.Struct({ proposal: ProposalJson }),
    execute: (threadId) =>
      sql`SELECT proposal_json AS "proposal" FROM ozone_design_proposals WHERE thread_id = ${threadId}`,
  });

  const pending = Effect.fn("BuildDesign.pending")(function* (threadId: ThreadId) {
    const row = yield* select(threadId).pipe(
      Effect.mapError(storageFailed("read the design directions")),
    );
    return Option.isSome(row) ? row.value.proposal : null;
  });

  const clear = Effect.fn("BuildDesign.clear")(function* (threadId: ThreadId) {
    yield* sql`DELETE FROM ozone_design_proposals WHERE thread_id = ${threadId}`.pipe(
      Effect.mapError(storageFailed("clear the design directions")),
    );
    yield* PubSub.publish(changed, { threadId, proposal: null });
  });

  const appOf = Effect.fn("BuildDesign.appOf")(function* (threadId: ThreadId) {
    const shell = yield* threads
      .getThreadShell(threadId)
      .pipe(Effect.mapError(() => failed("Ozone could not read the thread.")));
    if (shell === null) return yield* failed("The thread no longer exists.");
    return yield* registry.resolve(shell.projectId);
  });

  const pageAppOf = Effect.fn("BuildDesign.pageAppOf")(function* (threadId: ThreadId) {
    const app = yield* appOf(threadId);
    if (!PAGE_TEMPLATES.has(app.app.templateId)) return yield* failed(NO_PAGES);
    return app;
  });

  // Only the last deal counts: a re-deal moves away from it.
  const lastDeals = yield* Ref.make<ReadonlyMap<ThreadId, DesignDeal.DealIds>>(new Map());

  // Ozone's own copy, so an app of any age gets the same deal, and before its containers are up.
  const readLibrary = Effect.fn("BuildDesign.readLibrary")(
    function* (templateId: string) {
      const files = yield* templateFiles(templateId);
      const text = (name: string) =>
        new TextDecoder().decode(files.find((file) => file.path === name)?.bytes);
      const library = yield* DesignDeal.decodeLibrary({
        palettes: text(DesignDeal.LIBRARY_FILES.palettes),
        types: text(DesignDeal.LIBRARY_FILES.types),
      });
      return { files, library };
    },
    Effect.provideService(FileSystem.FileSystem, fs),
    Effect.provideService(Path.Path, path),
    Effect.mapError(() => failed("Ozone could not read its design library. Reinstall Ozone.")),
  );

  // Only what an agent reads: an older app's lint gate would check a skill's scripts and data.
  // SKILL.md goes last, so once it is there the copy finished, and a skill with one is left alone.
  const copySkills = Effect.fn("BuildDesign.copySkills")(
    function* (
      workspaceRoot: string,
      files: ReadonlyArray<TemplateFile>,
      skills: ReadonlyArray<string>,
    ) {
      for (const skill of skills) {
        const folder = `${DesignDeal.APP_SKILLS_PATH}/${skill}`;
        if (yield* fs.exists(path.join(workspaceRoot, folder, "SKILL.md"))) continue;
        for (const name of ["LICENSE", "agents/openai.yaml", "SKILL.md"]) {
          const file = files.find((entry) => entry.path === `${folder}/${name}`);
          if (file === undefined) continue;
          const target = path.join(workspaceRoot, ...file.path.split("/"));
          yield* fs.makeDirectory(path.dirname(target), { recursive: true });
          yield* fs.writeFile(target, file.bytes);
          yield* fs.chmod(target, file.mode);
        }
      }
    },
    Effect.mapError(storageFailed("copy the design skills into the app")),
  );

  return BuildDesign.of({
    pending,
    changes: (threadId) =>
      Stream.unwrap(
        Effect.gen(function* () {
          // Subscribed before the read, so a change in between is not missed.
          const updates = yield* PubSub.subscribe(changed);
          const current = yield* pending(threadId);
          return Stream.concat(
            Stream.make(current),
            Stream.fromSubscription(updates).pipe(
              Stream.filter((change) => change.threadId === threadId),
              Stream.map((change) => change.proposal),
            ),
          );
        }),
      ),
    deal: Effect.fn("BuildDesign.deal")(function* (threadId, request) {
      const app = yield* pageAppOf(threadId);
      const { files, library } = yield* readLibrary(app.app.templateId);
      const seeds = DesignDeal.deal(library, {
        kind: request.kind,
        trade: request.trade,
        avoid: (yield* Ref.get(lastDeals)).get(threadId),
      });
      yield* copySkills(
        app.workspaceRoot,
        files,
        seeds.map((seed) => seed.skill),
      );
      yield* Ref.update(lastDeals, (all) => new Map(all).set(threadId, DesignDeal.dealtIds(seeds)));
      return seeds;
    }),
    propose: Effect.fn("BuildDesign.propose")(function* (threadId, directions) {
      yield* pageAppOf(threadId);
      const proposal = { directions, proposedAt: DateTime.formatIso(yield* DateTime.now) };
      const json = yield* encodeProposal(proposal).pipe(
        Effect.mapError(storageFailed("save the design directions")),
      );
      yield* writing.withPermits(1)(
        sql`
          INSERT INTO ozone_design_proposals (thread_id, proposal_json, updated_at)
          VALUES (${threadId}, ${json}, ${proposal.proposedAt})
          ON CONFLICT (thread_id) DO UPDATE SET
            proposal_json = excluded.proposal_json,
            updated_at = excluded.updated_at
        `.pipe(Effect.mapError(storageFailed("save the design directions"))),
      );
      yield* PubSub.publish(changed, { threadId, proposal });
    }),
    answer: Effect.fn("BuildDesign.answer")(function* (threadId, pick) {
      const note = yield* writing.withPermits(1)(
        Effect.gen(function* () {
          const proposal = yield* pending(threadId);
          if (proposal === null) return null;
          const app = yield* appOf(threadId);
          if (pick === null) {
            yield* registry.configure(app.app.projectId, { chooseDesign: false });
            yield* clear(threadId);
            return WAKE.designLeft;
          }
          const direction = proposal.directions[pick];
          if (direction === undefined) {
            return yield* failed(`There is no design direction ${pick + 1}.`);
          }
          const skillFile =
            direction.skill !== undefined &&
            (yield* fs
              .exists(
                path.join(
                  app.workspaceRoot,
                  DesignDeal.APP_SKILLS_PATH,
                  direction.skill,
                  "SKILL.md",
                ),
              )
              .pipe(Effect.mapError(storageFailed("read the app's design skills"))));
          yield* fs
            .writeFileString(
              path.join(app.workspaceRoot, DESIGN_FILE),
              designFile(direction, { skillFile }),
            )
            .pipe(Effect.mapError(storageFailed(`write ${DESIGN_FILE}`)));
          yield* clear(threadId);
          return WAKE.designPicked(direction.name);
        }),
      );
      if (note !== null) yield* wake.wake(threadId, note);
    }),
  });
});

export const layer = Layer.effect(BuildDesign, make);
