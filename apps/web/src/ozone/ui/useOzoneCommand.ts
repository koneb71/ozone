import {
  isAtomCommandInterrupted,
  squashAtomCommandFailure,
  type AtomCommandResult,
} from "@t3tools/client-runtime/state/runtime";
import { useState } from "react";

import { stackedThreadToast, toastManager } from "~/components/ui/toast";

const failureText = (result: AtomCommandResult<unknown, unknown>, fallback: string) => {
  const failure = result._tag === "Failure" ? squashAtomCommandFailure(result) : null;
  return failure instanceof Error ? failure.message : fallback;
};

/**
 * Runs one thing at a time, says which is running, and reports a failure in a toast, the way
 * upstream's settings report a failed action.
 */
export function useOzoneCommand() {
  const [working, setWorking] = useState<string | null>(null);
  const run = async <A, E>(
    key: string,
    failureTitle: string,
    command: () => Promise<AtomCommandResult<A, E>>,
  ): Promise<AtomCommandResult<A, E>> => {
    setWorking(key);
    const result = await command();
    setWorking(null);
    if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: failureTitle,
          description: failureText(result, "Try again."),
        }),
      );
    }
    return result;
  };
  return { working, run };
}
