import { ListChecksIcon } from "lucide-react";

import { type ComposerThreadTarget, useComposerDraftStore } from "~/composerDraftStore";

import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { ComposerControl, ComposerControlIcon, type ComposerControlSize } from "./ComposerControl";

/**
 * Plan mode for the next message: the agent reads and proposes a plan and changes nothing. It
 * stays on for the thread until it is switched off, which is how a person says "now do it".
 */
export function ComposerPlanToggle(props: {
  readonly target: ComposerThreadTarget;
  /** A thread not started yet keeps the mode with its draft, so the thread is created in it. */
  readonly isDraft: boolean;
  readonly size: ComposerControlSize;
  readonly iconOnly: boolean;
  readonly disabled: boolean;
}) {
  const planning = useComposerDraftStore(
    (store) => store.getComposerDraft(props.target)?.interactionMode === "plan",
  );
  const setInteractionMode = useComposerDraftStore((store) => store.setInteractionMode);
  const setDraftThreadContext = useComposerDraftStore((store) => store.setDraftThreadContext);
  const toggle = () => {
    const next = planning ? "default" : "plan";
    // Null rather than "default", so a draft holding nothing else is dropped.
    setInteractionMode(props.target, planning ? null : "plan");
    if (props.isDraft) setDraftThreadContext(props.target, { interactionMode: next });
  };
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <ComposerControl
            aria-label="Plan mode"
            aria-pressed={planning}
            className="shrink-0"
            disabled={props.disabled}
            size={props.size}
            onClick={toggle}
          />
        }
      >
        <ComposerControlIcon icon={ListChecksIcon} size={props.size} />
        <span data-composer-control-label className={props.iconOnly ? "sr-only" : undefined}>
          Plan
        </span>
      </TooltipTrigger>
      <TooltipPopup side="top">
        {planning
          ? "Plan mode is on: the agent proposes a plan and changes nothing. Switch it off to have it do the work."
          : "Plan first: the agent proposes a plan and changes nothing until you switch this off."}
      </TooltipPopup>
    </Tooltip>
  );
}
