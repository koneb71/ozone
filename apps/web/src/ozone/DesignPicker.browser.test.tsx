import {
  OZONE_DESIGN_COMPOSITIONS,
  OZONE_DESIGN_MOTIONS,
  type OzoneDesignDirection,
  type OzoneDesignProposal,
} from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import "~/index.css";
import { act, fakeTimers, render } from "../../test/render";
import { MOTION_PLAN, showDirection } from "./design/designVocabulary.logic";
import { DirectionScreen } from "./design/DirectionScreen";
import { designBannerItem } from "./DesignPicker";

const direction = (
  name: string,
  overrides: Partial<OzoneDesignDirection>,
): OzoneDesignDirection => ({
  name,
  idea: `${name} in one sentence.`,
  colors: {
    background: "#f6f1e9",
    surface: "#ece3d4",
    text: "#1f1a14",
    muted: "#5f564b",
    accent: "#b4532a",
    accentText: "#fff8f0",
  },
  display: { family: "Fraunces", style: "serif" },
  body: { family: "Instrument Sans", style: "sans" },
  layout: "Headline left, picture right.",
  mood: "Warm",
  skill: "design-taste-frontend",
  composition: "split",
  material: "paper",
  motion: "lift",
  copy: {
    brand: "Harbor",
    headline: "Coffee roasted on the quay",
    lede: "Small batches, poured by the people who roast them.",
    cta: "Visit the bar",
    facts: ["Open from 7", "Roasted Tuesdays", "12 origins"],
  },
  ...overrides,
});

let proposals = 0;
// Each test gets its own proposal, since a proposal's arrival plays once per session.
const proposal = (): OzoneDesignProposal => ({
  proposedAt: `2026-11-19T00:00:0${(proposals += 1)}.000Z`,
  directions: [
    direction("Ember", {}),
    direction("Bezel", { skill: "high-end-visual-design", composition: "cascade", motion: "tilt" }),
    direction("Signal", { skill: "gpt-taste", composition: "monument", motion: "rise" }),
  ],
});

/** Animations the picker made itself, leaving out the dialog's CSS transitions. */
const scripted = () =>
  document.getAnimations().filter((animation) => animation.constructor === Animation);

const finishAll = () => {
  for (const animation of scripted()) animation.finish();
};

async function renderPicker(onAnswer: (pick: number | null) => void = () => {}) {
  const item = designBannerItem(proposal(), false, onAnswer);
  const screen = await render(<>{item?.children}</>);
  await vi.waitFor(() =>
    expect(document.querySelector('[aria-label="Design directions"]')).toHaveStyle({
      visibility: "visible",
    }),
  );
  return screen;
}

it("draws, in every composition, each part a motion moves", async () => {
  for (const composition of OZONE_DESIGN_COMPOSITIONS) {
    await using screen = await render(
      <DirectionScreen shown={showDirection(direction("Any", { composition }))} />,
    );
    for (const motion of OZONE_DESIGN_MOTIONS) {
      for (const step of MOTION_PLAN[motion]) {
        expect(
          screen.container.querySelectorAll(`[data-dp~="${step.part}"]`).length,
          `${composition} draws a ${step.part} for ${motion}`,
        ).toBeGreaterThan(0);
      }
    }
  }
});

it("plays a card's motion once on hover and then leaves nothing running", async () => {
  await using _screen = await renderPicker();
  using _timers = fakeTimers();
  await act(() => vi.runAllTimers());
  expect(scripted().length).toBeGreaterThan(0);
  finishAll();
  expect(scripted()).toEqual([]);

  await userEvent.hover(page.getByRole("button", { name: "See Signal large" }));
  expect(scripted().length).toBeGreaterThan(0);
  finishAll();
  expect(scripted()).toEqual([]);
});

it("opens a direction moving, then steps through them with the arrow keys", async () => {
  await using _screen = await renderPicker();
  finishAll();
  await userEvent.click(page.getByRole("button", { name: "See Bezel large" }));
  await vi.waitFor(() =>
    expect(
      scripted().some((animation) =>
        (animation.effect as KeyframeEffect | null)?.target?.closest('[role="dialog"]'),
      ),
    ).toBe(true),
  );
  const live = page.getByText(/of 3,/);
  await expect.element(live).toHaveTextContent("2 of 3, Bezel");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(live).toHaveTextContent("3 of 3, Signal");
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(live).toHaveTextContent("1 of 3, Ember");
  await userEvent.keyboard("{ArrowLeft}");
  await expect.element(live).toHaveTextContent("3 of 3, Signal");
});

it("moves nothing under reduced motion", async () => {
  const matchMedia = window.matchMedia.bind(window);
  using _reduced = vi
    .spyOn(window, "matchMedia")
    .mockImplementation((query) =>
      query.includes("prefers-reduced-motion")
        ? ({ ...matchMedia(query), matches: true } as MediaQueryList)
        : matchMedia(query),
    );
  await using _screen = await renderPicker();
  await userEvent.hover(page.getByRole("button", { name: "See Ember large" }));
  await userEvent.click(page.getByRole("button", { name: "See Ember large" }));
  await userEvent.keyboard("{ArrowRight}");
  await expect.element(page.getByText(/of 3,/)).toHaveTextContent("2 of 3, Bezel");
  expect(scripted()).toEqual([]);
});
