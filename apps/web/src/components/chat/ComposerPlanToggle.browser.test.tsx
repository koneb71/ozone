import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import "~/index.css";

import { useComposerDraftStore } from "~/composerDraftStore";

import { render } from "../../../test/render";
import { ComposerPlanToggle } from "./ComposerPlanToggle";

it("turns plan mode on and off for the thread's next message", async () => {
  const target = {
    environmentId: EnvironmentId.make("environment-plan-toggle"),
    threadId: ThreadId.make("thread-plan-toggle"),
  };
  const mode = () => useComposerDraftStore.getState().getComposerDraft(target)?.interactionMode;
  await using screen = await render(
    <ComposerPlanToggle
      target={target}
      isDraft={false}
      size="sm"
      iconOnly={false}
      disabled={false}
    />,
  );
  const toggle = screen.getByRole("button", { name: "Plan mode" });
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");

  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "true");
  expect(mode()).toBe("plan");

  await userEvent.click(toggle);
  await expect.element(toggle).toHaveAttribute("aria-pressed", "false");
  expect(mode() ?? null).toBeNull();
});
