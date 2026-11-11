import { CommandId, MessageId, type ThreadId } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import * as ThreadManagementService from "../../orchestration-v2/ThreadManagementService.ts";

export interface WakeNote {
  /** What the person reads in the thread. */
  readonly summary: string;
  /** What the lead reads. */
  readonly text: string;
  readonly outcome: "completed" | "failed";
}

/**
 * Starts a turn in a lead's thread when something it was told to wait for has happened. The lead
 * ends its turn instead of holding a tool call open, so the server has to bring it back.
 */
export class BuildWake extends Context.Service<
  BuildWake,
  {
    /** Never fails: a lead that cannot be woken is found again by the next call it makes. */
    readonly wake: (threadId: ThreadId, note: WakeNote) => Effect.Effect<void>;
  }
>()("t3/ozone/builds/BuildWake") {}

const make = Effect.gen(function* () {
  const threads = yield* ThreadManagementService.ThreadManagementService;
  const random = yield* SecureRandom.SecureRandom;

  return BuildWake.of({
    wake: Effect.fn("BuildWake.wake")(function* (threadId, note) {
      const id = yield* random.uuidV4();
      yield* threads
        .dispatch({
          type: "message.dispatch",
          commandId: CommandId.make(`ozone-wake:${id}`),
          threadId,
          messageId: MessageId.make(`ozone-wake-message:${id}`),
          text: note.text,
          notification: {
            source: { kind: "background_task" },
            outcome: note.outcome,
            summary: note.summary,
            detail: note.text,
          },
          attachments: [],
          // After the turn that is running, if one is: a wake never interrupts the lead.
          dispatchMode: { type: "queue_after_active" },
          createdBy: "agent",
          creationSource: "server",
        })
        .pipe(
          Effect.catchCause((cause) =>
            Effect.logWarning("ozone.build.wake-failed", { threadId, cause }),
          ),
        );
    }),
  });
});

export const layer = Layer.effect(BuildWake, make);
