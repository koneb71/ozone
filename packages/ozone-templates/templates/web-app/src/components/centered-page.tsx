import type { ReactNode } from "react";

/** A full-height page with its content centred over the dot grid. */
export function CenteredPage({ children }: { children: ReactNode }) {
  return (
    <main className="relative grid min-h-dvh place-items-center px-6 py-16">
      <div aria-hidden="true" className="bg-dot-grid absolute inset-0 -z-10" />
      {children}
    </main>
  );
}
