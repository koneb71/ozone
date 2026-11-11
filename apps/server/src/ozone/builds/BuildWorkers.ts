import {
  OzoneAppError,
  type NodeId,
  type OzoneBuildTaskAccess,
  type ThreadId,
} from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Duration from "effect/Duration";
import * as DurationModule from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { McpInvocationScope } from "../../mcp/McpInvocationContext.ts";
import * as OrchestratorMcpService from "../../mcp/OrchestratorMcpService.ts";

export interface WorkerHandle {
  readonly workerTaskId: NodeId;
  readonly workerThreadId: ThreadId | null;
}

export interface WorkerStatus {
  readonly state: "working" | "waiting_for_answer" | "completed" | "failed";
  readonly summary: string | null;
  /** For `failed`: how the worker ended. */
  readonly ending: string | null;
}

/**
 * Workers are upstream's delegated tasks: durable child threads on any provider. This is the
 * whole of what a build asks of them, so the conductor can be tested without a provider.
 */
export class BuildWorkers extends Context.Service<
  BuildWorkers,
  {
    readonly dispatch: (
      scope: McpInvocationScope,
      input: {
        /** Makes a repeated call the same piece of work within one provider session. */
        readonly key: string;
        readonly title: string;
        readonly brief: string;
        readonly access: OzoneBuildTaskAccess;
      },
    ) => Effect.Effect<WorkerHandle, OzoneAppError>;
    readonly status: (
      scope: McpInvocationScope,
      workerTaskId: NodeId,
    ) => Effect.Effect<WorkerStatus, OzoneAppError>;
    /** Returns when the worker's thread settles or the time is up, whichever is first. */
    readonly wait: (
      scope: McpInvocationScope,
      workerThreadId: ThreadId,
      timeout: Duration.Duration,
    ) => Effect.Effect<void>;
  }
>()("t3/ozone/builds/BuildWorkers") {}

const failed = (message: string) => new OzoneAppError({ reason: "failed", message });

const make = Effect.gen(function* () {
  const orchestrator = yield* OrchestratorMcpService.OrchestratorMcpService;

  return BuildWorkers.of({
    dispatch: Effect.fn("BuildWorkers.dispatch")(function* (scope, input) {
      const task = yield* orchestrator
        .delegateTask(scope, {
          task: input.brief,
          title: input.title,
          role: input.access === "read" ? "research" : "implementation",
          // The conductor does its own waiting, so a restart can pick the worker up by its id.
          mode: "async",
          clientRequestId: input.key,
        })
        .pipe(Effect.mapError((error) => failed(`Could not start a worker: ${error.message}`)));
      return { workerTaskId: task.taskId, workerThreadId: task.childThreadId };
    }),
    status: Effect.fn("BuildWorkers.status")(function* (scope, workerTaskId) {
      // Reading a finished task also acknowledges it, so upstream does not wake the lead for it.
      const task = yield* orchestrator
        .taskStatus(scope, workerTaskId)
        .pipe(Effect.mapError((error) => failed(`Could not read a worker: ${error.message}`)));
      const summary = task.summary ?? task.latestTerminalSummary;
      if (task.status === "completed") return { state: "completed", summary, ending: null };
      if (
        task.status === "failed" ||
        task.status === "cancelled" ||
        task.status === "interrupted"
      ) {
        return { state: "failed", summary, ending: task.status };
      }
      return {
        state:
          task.hasPendingQuestion || task.pendingApproval !== null
            ? "waiting_for_answer"
            : "working",
        summary,
        ending: null,
      };
    }),
    wait: Effect.fn("BuildWorkers.wait")((scope, workerThreadId, timeout) =>
      orchestrator
        .waitForThread(scope, {
          threadId: workerThreadId,
          timeoutMs: Math.max(1, DurationModule.toMillis(timeout)),
          untilDelegatedWorkSettled: true,
        })
        .pipe(Effect.ignore),
    ),
  });
});

export const layer = Layer.effect(BuildWorkers, make);
