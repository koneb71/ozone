import { proposedPlanTitle } from "@t3tools/shared/proposedPlanText";
import { CheckIcon, ListChecksIcon } from "lucide-react";

import { Button } from "../ui/button";
import type { ComposerBannerStackItem } from "./ComposerBannerStack";

/** What a proposed plan needs from the person, above the message box. */
export function planReviewBannerItem(input: {
  readonly planMarkdown: string;
  readonly busy: boolean;
  /** Leaves plan mode and tells the agent to do the work. */
  readonly onApprove: () => void;
  /** Stays in plan mode and puts the cursor in the message box. */
  readonly onRevise: () => void;
  /** Leaves plan mode and sends nothing. */
  readonly onDecline: () => void;
}): ComposerBannerStackItem {
  return {
    id: "plan-review",
    variant: "info",
    group: "attention",
    icon: <ListChecksIcon />,
    title: "Plan ready",
    description:
      proposedPlanTitle(input.planMarkdown) ?? "Approve it, ask for changes, or decline.",
    actions: (
      <>
        <Button disabled={input.busy} size="xs" variant="ghost" onClick={input.onDecline}>
          Decline
        </Button>
        <Button disabled={input.busy} size="xs" variant="outline" onClick={input.onRevise}>
          Revise
        </Button>
        <Button disabled={input.busy} size="xs" onClick={input.onApprove}>
          <CheckIcon />
          Approve
        </Button>
      </>
    ),
  };
}
