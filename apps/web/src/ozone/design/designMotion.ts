import type { OzoneDesignMotion } from "@t3tools/contracts";

import { framesFor, MOTION_PLAN } from "./designVocabulary.logic";

const prefersReducedMotion = (element: Element) =>
  element.ownerDocument.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches ??
  false;

/**
 * Plays a direction's motion once over a drawn screen. Each element moves in one step only,
 * and every step ends where the screen rests, so nothing is left running or styled after it.
 */
function playMotion(
  root: HTMLElement,
  motion: OzoneDesignMotion,
  wait: number,
): ReadonlyArray<Animation> {
  if (prefersReducedMotion(root)) return [];
  const moved = new Set<Element>();
  const animations: Array<Animation> = [];
  for (const step of MOTION_PLAN[motion]) {
    const elements = [...root.querySelectorAll<HTMLElement>(`[data-dp~="${step.part}"]`)]
      .filter((element) => !moved.has(element))
      .slice(0, step.limit);
    elements.forEach((element, index) => {
      moved.add(element);
      animations.push(
        element.animate([...framesFor(step, index)], {
          duration: step.duration,
          delay: wait + step.delay + step.stagger * index,
          easing: step.easing,
          fill: "backwards",
          iterations: 1,
        }),
      );
    });
  }
  return animations;
}

/**
 * One screen's motion: a play while one runs is ignored, so hovering back and forth stays calm.
 * `wait` delays it on the animation timeline, which holds the first frame meanwhile.
 */
export function createMotionPlayer() {
  let running: ReadonlyArray<Animation> = [];
  const busy = () => running.some((animation) => animation.playState === "running");
  return {
    play(root: HTMLElement | null, motion: OzoneDesignMotion, wait = 0) {
      if (root === null || busy()) return;
      running = playMotion(root, motion, wait);
    },
    cancel() {
      for (const animation of running) animation.cancel();
      running = [];
    },
  };
}

const MAX_TILT_DEG = 8;

/**
 * Turns `target` toward the pointer while it moves over `surface`, one frame per move at most,
 * and eases it back when the pointer leaves. Only for a fine pointer and without reduced motion.
 */
export function attachPointerTilt(surface: HTMLElement, target: () => HTMLElement | null) {
  const view = surface.ownerDocument.defaultView;
  if (
    view === null ||
    prefersReducedMotion(surface) ||
    !view.matchMedia("(hover: hover) and (pointer: fine)").matches
  ) {
    return () => {};
  }
  let frame = 0;
  let last: PointerEvent | null = null;
  const apply = () => {
    frame = 0;
    const element = target();
    if (element === null || last === null) return;
    const box = surface.getBoundingClientRect();
    const x = (last.clientX - box.left) / box.width - 0.5;
    const y = (last.clientY - box.top) / box.height - 0.5;
    element.style.transition = "transform 120ms linear";
    element.style.transform = `rotateY(${(x * 2 * MAX_TILT_DEG).toFixed(2)}deg) rotateX(${(-y * 2 * MAX_TILT_DEG).toFixed(2)}deg)`;
  };
  const move = (event: PointerEvent) => {
    last = event;
    if (frame === 0) frame = view.requestAnimationFrame(apply);
  };
  const leave = () => {
    if (frame !== 0) view.cancelAnimationFrame(frame);
    frame = 0;
    const element = target();
    if (element === null) return;
    element.style.transition = "transform 400ms cubic-bezier(.22,1,.36,1)";
    element.style.transform = "";
  };
  surface.addEventListener("pointermove", move);
  surface.addEventListener("pointerleave", leave);
  return () => {
    surface.removeEventListener("pointermove", move);
    surface.removeEventListener("pointerleave", leave);
    leave();
  };
}
