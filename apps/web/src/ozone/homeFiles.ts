import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";
import { create } from "zustand";

import { useComposerHandleContext } from "~/composerHandleContext";

interface HomeFiles {
  readonly threadRef: ScopedThreadRef;
  readonly files: ReadonlyArray<File>;
  /** A build waits for the person to send: the files are staged, not sent. */
  readonly startsBuild: boolean;
}

/**
 * Files picked on Home, on their way to the composer of the chat opened for them. Upstream's
 * composer owns attachment intake (conversion, compression, upload), so Home hands files over
 * instead of preparing them a second way.
 */
const useHomeFilesStore = create<{
  readonly waiting: HomeFiles | null;
  /** The thread whose composer holds a build request that has not been sent yet. */
  readonly buildStagedIn: ScopedThreadRef | null;
}>()(() => ({
  waiting: null,
  buildStagedIn: null,
}));

const sameThread = (left: ScopedThreadRef | null, right: ScopedThreadRef | null) =>
  left !== null &&
  right !== null &&
  left.environmentId === right.environmentId &&
  left.threadId === right.threadId;

const isFor = (waiting: HomeFiles | null, threadRef: ScopedThreadRef | null) =>
  waiting !== null && sameThread(waiting.threadRef, threadRef);

export const queueHomeFiles = (
  threadRef: ScopedThreadRef,
  files: ReadonlyArray<File>,
  options?: { readonly startsBuild?: boolean },
) =>
  useHomeFilesStore.setState({
    waiting: { threadRef, files, startsBuild: options?.startsBuild === true },
  });

/** True while `threadRef`'s composer holds a build request from Home that was not sent yet. */
export const useBuildStagedIn = (threadRef: ScopedThreadRef | null) =>
  useHomeFilesStore((state) => sameThread(state.buildStagedIn, threadRef));

/** Gives the composer of `threadRef` the files Home queued for it, once. */
export function useHomeFilesDelivery(threadRef: ScopedThreadRef | null) {
  const composerRef = useComposerHandleContext();
  const expected = useHomeFilesStore((state) => isFor(state.waiting, threadRef));

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- hands files picked on Home to the composer's imperative API once it has mounted
  useEffect(() => {
    if (!expected || composerRef === null) return;
    const deliver = () => {
      const composer = composerRef.current;
      const { waiting } = useHomeFilesStore.getState();
      if (composer === null || waiting === null || !isFor(waiting, threadRef)) return;
      useHomeFilesStore.setState({
        waiting: null,
        buildStagedIn: waiting.startsBuild ? waiting.threadRef : null,
      });
      composer.addDroppedFiles([...waiting.files]);
    };
    // A parent's effect can run before the composer below it has published its handle.
    const frame = window.requestAnimationFrame(deliver);
    return () => window.cancelAnimationFrame(frame);
  }, [composerRef, expected, threadRef]);
}
