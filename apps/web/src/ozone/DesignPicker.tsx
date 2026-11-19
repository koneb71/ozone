import type { OzoneDesignProposal } from "@t3tools/contracts";
import { Maximize2Icon, PaletteIcon } from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type PointerEvent,
} from "react";

import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";
import { Button } from "~/components/ui/button";

import { createMotionPlayer } from "./design/designMotion";
import { ensureFaces } from "./design/designFonts";
import { DesignViewer } from "./design/DesignViewer";
import {
  facesOf,
  SKILL_LABEL,
  showDirection,
  type ShownDirection,
} from "./design/designVocabulary.logic";
import { DirectionScreen } from "./design/DirectionScreen";

/** Proposals whose cards already played their arrival, so folding and unfolding stays still. */
const arrived = new Set<string>();

const ARRIVAL_STAGGER_MS = 200;
/** The longest the cards wait for their faces before showing in stand-ins. */
const FACES_CAP_MS = 700;

function DirectionCard({
  shown,
  arrival,
  disabled,
  onOpen,
  onPick,
}: {
  readonly shown: ShownDirection;
  /** Delay before the card plays its motion once on arrival, or null when it stays still. */
  readonly arrival: number | null;
  readonly disabled: boolean;
  readonly onOpen: () => void;
  readonly onPick: () => void;
}) {
  const screenRef = useRef<HTMLDivElement>(null);
  const player = useRef(createMotionPlayer());
  const { direction } = shown;

  // A layout effect, so the first frame is in place before the card first paints; the stagger is a
  // delay on the animation timeline, which holds that frame meanwhile.
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- plays the arrival with the Web Animations API once the faces have loaded
  useLayoutEffect(() => {
    if (arrival === null) return;
    const card = player.current;
    card.play(screenRef.current, shown.motion, arrival);
    return () => card.cancel();
  }, [arrival, shown.motion]);

  const play = () => player.current.play(screenRef.current, shown.motion);
  const onPointerEnter = (event: PointerEvent) => {
    if (event.pointerType === "mouse") play();
  };
  const onFocus = (event: FocusEvent<HTMLButtonElement>) => {
    if (event.currentTarget.matches(":focus-visible")) play();
  };

  return (
    <li aria-label={direction.name} className="flex min-w-0 snap-start flex-col gap-1.5">
      <button
        type="button"
        aria-label={`See ${direction.name} large`}
        className="group relative block overflow-hidden rounded-lg outline-none ring-1 ring-border/70 transition-shadow hover:ring-foreground/30 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        onClick={onOpen}
        onFocus={onFocus}
        onPointerEnter={onPointerEnter}
      >
        <DirectionScreen shown={shown} rootRef={screenRef} />
        <span className="pointer-events-none absolute right-1.5 bottom-1.5 rounded-md bg-black/60 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2Icon className="size-3" />
        </span>
      </button>
      <div className="flex min-w-0 items-center justify-between gap-2 px-0.5">
        <div className="min-w-0">
          <p className="m-0 truncate font-medium text-foreground text-xs">{direction.name}</p>
          <p className="m-0 truncate text-muted-foreground text-xs">
            {direction.skill === undefined
              ? direction.mood
              : `${SKILL_LABEL[direction.skill]} · ${direction.mood}`}
          </p>
        </div>
        <Button
          aria-label={`Use ${direction.name}`}
          disabled={disabled}
          size="xs"
          variant="outline"
          onClick={onPick}
        >
          Use
        </Button>
      </div>
    </li>
  );
}

function DesignDirections({
  proposal,
  answering,
  onAnswer,
}: {
  readonly proposal: OzoneDesignProposal;
  readonly answering: boolean;
  readonly onAnswer: (pick: number | null) => void;
}) {
  const directions = proposal.directions.map(showDirection);
  const [viewing, setViewing] = useState<number | null>(null);
  const [facesReady, setFacesReady] = useState<string | null>(null);
  const firstShowing = !arrived.has(proposal.proposedAt);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- loads the bundled faces into document.fonts before the cards show, or gives up waiting
  useEffect(() => {
    let live = true;
    const show = () => {
      if (live) setFacesReady(proposal.proposedAt);
    };
    const cap = window.setTimeout(show, FACES_CAP_MS);
    void ensureFaces(proposal.directions.flatMap(facesOf)).then(show);
    return () => {
      live = false;
      window.clearTimeout(cap);
    };
  }, [proposal]);

  const ready = facesReady === proposal.proposedAt;
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- records outside React that this proposal's arrival has played
  useEffect(() => {
    if (ready) arrived.add(proposal.proposedAt);
  }, [ready, proposal.proposedAt]);

  return (
    <>
      <ul
        aria-label="Design directions"
        className="m-0 grid list-none auto-cols-[minmax(15rem,1fr)] grid-flow-col gap-3 overflow-x-auto overscroll-x-contain p-0 pb-1 snap-x snap-mandatory [@media(max-height:40rem)]:auto-cols-[minmax(11rem,1fr)]"
        style={{ visibility: ready ? "visible" : "hidden" }}
      >
        {directions.map((shown, index) => (
          <DirectionCard
            key={`${shown.direction.name}:${shown.direction.colors.background}:${shown.direction.colors.accent}`}
            shown={shown}
            arrival={ready && firstShowing ? index * ARRIVAL_STAGGER_MS : null}
            disabled={answering}
            onOpen={() => setViewing(index)}
            onPick={() => onAnswer(index)}
          />
        ))}
      </ul>
      {viewing === null ? null : (
        <DesignViewer
          key={proposal.proposedAt}
          directions={directions}
          start={viewing}
          answering={answering}
          onPick={(pick) => {
            setViewing(null);
            onAnswer(pick);
          }}
          onClose={() => setViewing(null)}
        />
      )}
    </>
  );
}

/** The directions the lead offered, as one composer notice, or nothing when none wait. */
export function designBannerItem(
  proposal: OzoneDesignProposal | null,
  answering: boolean,
  onAnswer: (pick: number | null) => void,
): ComposerBannerStackItem | null {
  if (proposal === null || proposal.directions.length === 0) return null;
  return {
    id: "ozone-design",
    variant: "info",
    group: "attention",
    icon: <PaletteIcon />,
    title: "Pick a design",
    description: "One per design skill. Open one to see it large and moving.",
    actions: (
      <Button disabled={answering} size="xs" variant="ghost" onClick={() => onAnswer(null)}>
        Let the lead choose
      </Button>
    ),
    children: <DesignDirections proposal={proposal} answering={answering} onAnswer={onAnswer} />,
    collapsible: { defaultOpen: true, what: "directions" },
  };
}
