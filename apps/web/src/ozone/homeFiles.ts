import type { ScopedThreadRef } from "@t3tools/contracts";
import { useEffect } from "react";
import { create } from "zustand";

import { useComposerHandleContext } from "~/composerHandleContext";

interface HomeFiles {
  readonly threadRef: ScopedThreadRef;
  readonly files: ReadonlyArray<File>;
}

/**
 * Files picked on Home, on their way to the composer of the chat opened for them. Upstream's
 * composer owns attachment intake (conversion, compression, upload), so Home hands files over
 * instead of preparing them a second way.
 */
const useHomeFilesStore = create<{ readonly waiting: HomeFiles | null }>()(() => ({
  waiting: null,
}));

const isFor = (waiting: HomeFiles | null, threadRef: ScopedThreadRef | null) =>
  waiting !== null &&
  threadRef !== null &&
  waiting.threadRef.environmentId === threadRef.environmentId &&
  waiting.threadRef.threadId === threadRef.threadId;

export const queueHomeFiles = (threadRef: ScopedThreadRef, files: ReadonlyArray<File>) =>
  useHomeFilesStore.setState({ waiting: { threadRef, files } });

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
      useHomeFilesStore.setState({ waiting: null });
      composer.addDroppedFiles([...waiting.files]);
    };
    // A parent's effect can run before the composer below it has published its handle.
    const frame = window.requestAnimationFrame(deliver);
    return () => window.cancelAnimationFrame(frame);
  }, [composerRef, expected, threadRef]);
}
