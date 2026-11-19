import { OZONE_DESIGN_MOTIONS, type OzoneDesignDirection } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  framesFor,
  headlineSize,
  MOTION_PLAN,
  motionLength,
  showDirection,
  turnKeyframes,
} from "./designVocabulary.logic";

const MOVING = new Set(["transform", "opacity", "offset", "easing", "composite"]);

describe("MOTION_PLAN", () => {
  it.each(OZONE_DESIGN_MOTIONS)(
    "%s moves only transform and opacity and ends at rest",
    (motion) => {
      let elements = 0;
      for (const step of MOTION_PLAN[motion]) {
        elements += step.limit;
        for (const index of [0, step.limit - 1]) {
          const frames = framesFor(step, index);
          for (const frame of frames) {
            expect(Object.keys(frame).filter((key) => !MOVING.has(key))).toEqual([]);
          }
          const last = frames.at(-1);
          // The sheen rests unseen; everything else rests where the screen draws it.
          if (step.part === "sheen") expect(last?.opacity).toBe(0);
          else {
            expect(last?.transform).toBe("none");
            if (frames.some((frame) => frame.opacity !== undefined)) expect(last?.opacity).toBe(1);
          }
        }
      }
      expect(elements).toBeLessThanOrEqual(12);
      expect(motionLength(motion)).toBeLessThanOrEqual(1600);
    },
  );
});

it("turns the outgoing face away by the angle the incoming one turns in from", () => {
  for (const forward of [true, false]) {
    const { out, in: incoming } = turnKeyframes(forward);
    expect(out[0]?.transform).toBe(incoming.at(-1)?.transform);
    expect(out.at(-1)?.transform).toBe(
      incoming[0]?.transform
        ?.toString()
        .replace(/rotateY\((-?\d+)deg\)/, (_, deg: string) => `rotateY(${-Number(deg)}deg)`),
    );
  }
});

it("shrinks a long headline so it keeps to three lines", () => {
  const short = headlineSize("monument", "Slow coffee");
  const long = headlineSize(
    "monument",
    "Roasted in small batches on the harbour every single morning",
  );
  expect(long).toBeLessThan(short);
  expect(long).toBeGreaterThan(0);
});

it("draws a direction from before skills and motion with what it has", () => {
  const direction: OzoneDesignDirection = {
    name: "Harbor",
    idea: "A calm cafe by the water.",
    colors: {
      background: "#f6f1e9",
      surface: "#ece4d6",
      text: "#1f1a14",
      muted: "#6b5f52",
      accent: "#b4532a",
      accentText: "#fff8f0",
    },
    display: { family: "Fraunces", style: "serif" },
    body: { family: "Work Sans", style: "sans" },
    layout: "Headline left, photo right.",
    mood: "Warm",
  };
  expect(showDirection(direction)).toMatchObject({
    composition: "split",
    material: "paper",
    motion: "lift",
    copy: { headline: "Harbor", lede: "A calm cafe by the water." },
  });
});
