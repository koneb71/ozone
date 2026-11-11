import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useScratchProject } from "~/hooks/useScratchProject";
import { newMessageId, newThreadId } from "~/lib/utils";
import {
  resolveDefaultProviderModelSelection,
  resolveProjectDefaultProviderModelSelection,
} from "~/providerInstances";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { waitForProject, waitForThreadShell } from "~/state/entities";
import { environmentPresentations } from "~/state/presentation";
import { environmentServerConfigsAtom } from "~/state/server";
import { threadEnvironment } from "~/state/threads";
import { useAtomCommand } from "~/state/use-atom-command";
import { useOrchestrationCommand } from "~/state/use-orchestration-command";
import { buildThreadRouteParams } from "~/threadRoutes";
import { DEFAULT_INTERACTION_MODE } from "~/types";

import { appNameFromPrompt } from "./home.logic";
import { ozoneEnvironment } from "./state";

/** Null when the launch worked and the thread is open; otherwise what to tell the user. */
type LaunchOutcome = string | null;

const failureMessage = (
  result: Extract<AtomCommandResult<unknown, unknown>, { readonly _tag: "Failure" }>,
  fallback: string,
): string => {
  const error = squashAtomCommandFailure(result);
  return error instanceof Error && error.message.trim().length > 0 ? error.message : fallback;
};

/** What a new thread in this project would use, read at call time. */
function newThreadDefaults(environmentId: EnvironmentId, projectId: ProjectId) {
  const settings = appAtomRegistry.get(environmentServerConfigsAtom).get(environmentId)?.settings;
  if (settings === undefined) return null;
  const providers =
    appAtomRegistry.get(environmentPresentations.providersByEnvironmentAtom).get(environmentId) ??
    [];
  const modelSelection: ModelSelection | null =
    settings.defaultModelSelection === null
      ? resolveProjectDefaultProviderModelSelection(providers, settings, projectId)
      : resolveDefaultProviderModelSelection(providers, settings.defaultModelSelection);
  return modelSelection === null
    ? null
    : { modelSelection, runtimeMode: settings.defaultRuntimeMode };
}

/** Starts the two things Home offers: a new app with its lead thread, or a chat. */
export function useOzoneLaunch() {
  const navigate = useNavigate();
  const createApp = useAtomCommand(ozoneEnvironment.createApp, { reportFailure: false });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const { openScratchProject } = useScratchProject();

  const startThread = async (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    text: string,
  ): Promise<LaunchOutcome> => {
    const defaults = newThreadDefaults(environmentId, projectId);
    if (defaults === null) {
      return "No model is ready yet. Sign in to a provider in Settings, then try again.";
    }
    const threadId = newThreadId();
    const createdAt = new Date().toISOString();
    const title = deriveThreadTitleSeed({ text, attachments: [] });
    const started = await startThreadTurn({
      environmentId,
      input: {
        threadId,
        message: { messageId: newMessageId(), role: "user", text, attachments: [] },
        modelSelection: defaults.modelSelection,
        titleSeed: title,
        runtimeMode: defaults.runtimeMode,
        interactionMode: DEFAULT_INTERACTION_MODE,
        bootstrap: {
          createThread: {
            projectId,
            title,
            modelSelection: defaults.modelSelection,
            runtimeMode: defaults.runtimeMode,
            interactionMode: DEFAULT_INTERACTION_MODE,
            branch: null,
            worktreePath: null,
            createdAt,
          },
        },
        createdAt,
      },
    });
    if (started._tag === "Failure") return failureMessage(started, "Could not start the thread.");
    const threadRef = scopeThreadRef(environmentId, threadId);
    await waitForThreadShell(threadRef);
    await navigate({ to: "/$environmentId/$threadId", params: buildThreadRouteParams(threadRef) });
    return null;
  };

  const build = async (environmentId: EnvironmentId, prompt: string): Promise<LaunchOutcome> => {
    const created = await createApp({
      environmentId,
      input: { name: appNameFromPrompt(prompt) },
    });
    if (created._tag === "Failure") return failureMessage(created, "Could not create the app.");
    // The thread it opens next looks the new app up in this list.
    appAtomRegistry.refresh(ozoneEnvironment.apps({ environmentId, input: {} }));
    const { projectId } = created.value.app;
    const arrived = await waitForProject(scopeProjectRef(environmentId, projectId)).then(
      () => true,
      () => false,
    );
    if (!arrived)
      return "The app was created, but it has not reached this window. Reload to see it.";
    return startThread(environmentId, projectId, prompt);
  };

  const chat = async (environmentId: EnvironmentId, prompt: string): Promise<LaunchOutcome> => {
    const project = await openScratchProject(environmentId, "Could not start a chat");
    // openScratchProject reports its own failure.
    return project === null ? null : startThread(environmentId, project.id, prompt);
  };

  return { build, chat };
}
