import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { deriveThreadTitleSeed } from "@t3tools/client-runtime/operations";
import {
  type AtomCommandResult,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import type { EnvironmentId, ModelSelection, ProjectId } from "@t3tools/contracts";
import { useNavigate } from "@tanstack/react-router";

import { useNewThreadHandler } from "~/hooks/useHandleNewThread";
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
import { queueHomeFiles } from "./homeFiles";
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

/** Starts what Home offers: a new app with its lead thread, a chat, or a chat about files. */
export function useOzoneLaunch() {
  const navigate = useNavigate();
  const createApp = useAtomCommand(ozoneEnvironment.createApp, { reportFailure: false });
  const startThreadTurn = useOrchestrationCommand(threadEnvironment.startTurn, {
    reportFailure: false,
  });
  const { openScratchProject } = useScratchProject();
  const handleNewThread = useNewThreadHandler();

  const startThread = async (
    environmentId: EnvironmentId,
    projectId: ProjectId,
    text: string,
  ): Promise<LaunchOutcome> => {
    const defaults = newThreadDefaults(environmentId, projectId);
    if (defaults === null) {
      return "No model is ready yet. Open Settings, choose Providers and sign in to Claude, then try again. Claude Code must be installed on this machine first.";
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

  const build = async (
    environmentId: EnvironmentId,
    prompt: string,
    options: {
      readonly files: ReadonlyArray<File>;
      readonly reviewPlans: boolean;
      readonly templateId: string;
    },
  ): Promise<LaunchOutcome> => {
    const { files, reviewPlans, templateId } = options;
    const created = await createApp({
      environmentId,
      input: { name: appNameFromPrompt(prompt), templateId, settings: { reviewPlans } },
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
    if (files.length === 0) return startThread(environmentId, projectId, prompt);
    // The composer prepares attachments, so the request waits in it for the person to send.
    const draft = await handleNewThread(scopeProjectRef(environmentId, projectId), { prompt });
    if (draft === null) return "The app was created. Open it from the list to start its build.";
    queueHomeFiles(scopeThreadRef(environmentId, draft.threadId), files, { startsBuild: true });
    return null;
  };

  const chat = async (environmentId: EnvironmentId, prompt: string): Promise<LaunchOutcome> => {
    const project = await openScratchProject(environmentId, "Could not start a chat");
    // openScratchProject reports its own failure.
    return project === null ? null : startThread(environmentId, project.id, prompt);
  };

  /** Opens a new chat with the files and the text typed so far in its composer, unsent. */
  const chatWithFiles = async (
    environmentId: EnvironmentId,
    prompt: string,
    files: ReadonlyArray<File>,
  ): Promise<LaunchOutcome> => {
    const project = await openScratchProject(environmentId, "Could not start a chat");
    if (project === null) return null;
    const draft = await handleNewThread(scopeProjectRef(environmentId, project.id), { prompt });
    if (draft === null) return "The chat did not open. Try again.";
    queueHomeFiles(scopeThreadRef(environmentId, draft.threadId), files);
    return null;
  };

  return { build, chat, chatWithFiles };
}
