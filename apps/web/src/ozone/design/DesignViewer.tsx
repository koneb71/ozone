import { ChevronLeftIcon, ChevronRightIcon, PlayIcon, XIcon } from "lucide-react";
import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";

import { Button } from "~/components/ui/button";
import { Dialog, DialogPopup, DialogTitle } from "~/components/ui/dialog";

import { attachPointerTilt, createMotionPlayer } from "./designMotion";
import {
  COMPOSITION_WORDS,
  MATERIAL_WORDS,
  MOTION_WORDS,
  SKILL_LABEL,
  shownFamily,
  TURN_EASING,
  TURN_MS,
  turnKeyframes,
  wrapIndex,
  type ShownDirection,
} from "./designVocabulary.logic";
import { DirectionScreen } from "./DirectionScreen";

const SWATCHES = [
  ["background", "Background"],
  ["surface", "Surface"],
  ["text", "Text"],
  ["muted", "Muted text"],
  ["accent", "Accent"],
  ["accentText", "Text on the accent"],
] as const;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The faces in words, naming the stand-in when Ozone does not carry a face. */
function faceNote(shown: ShownDirection) {
  const { display, body } = shown.direction;
  const faces = display.family === body.family ? [display] : [display, body];
  return faces
    .map((face) => {
      const family = shownFamily(face);
      return family === face.family
        ? face.family
        : `${face.family} (shown in ${family ?? "a system face"})`;
    })
    .join(" and ");
}

interface Turn {
  readonly from: number;
  readonly forward: boolean;
}

type Player = ReturnType<typeof createMotionPlayer>;

/**
 * The viewer's inside. Its effects live here, not in `DesignViewer`, because the dialog mounts
 * its content in a portal after the dialog itself: only from in here are the stage's refs set.
 */
function Stage({
  directions,
  index,
  turn,
  answering,
  stageRef,
  player,
  onGo,
  onLanded,
  onPick,
  onClose,
}: {
  readonly directions: ReadonlyArray<ShownDirection>;
  readonly index: number;
  readonly turn: Turn | null;
  readonly answering: boolean;
  readonly stageRef: RefObject<HTMLDivElement | null>;
  readonly player: Player;
  readonly onGo: (step: number) => void;
  readonly onLanded: () => void;
  readonly onPick: (index: number) => void;
  readonly onClose: () => void;
}) {
  const riseRef = useRef<HTMLDivElement>(null);
  const incomingRef = useRef<HTMLDivElement>(null);
  const outgoingRef = useRef<HTMLDivElement>(null);
  const screenRef = useRef<HTMLDivElement>(null);
  const shown = directions[index] ?? directions[0];
  const motion = shown?.motion ?? "lift";

  const play = () => player.play(screenRef.current, motion);
  const playOpening = useEffectEvent((wait: number) =>
    player.play(screenRef.current, motion, wait),
  );
  const land = useEffectEvent(() => {
    onLanded();
    play();
  });

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- runs the opening rise and the first direction's motion with the Web Animations API
  useLayoutEffect(() => {
    const wrapper = riseRef.current;
    if (wrapper === null || reducedMotion()) return;
    const rise = wrapper.animate(
      [
        { transform: "rotateX(16deg) scale(.94)", opacity: 0 },
        { transform: "none", opacity: 1 },
      ],
      { duration: 520, delay: 140, easing: "cubic-bezier(.22,1,.36,1)", fill: "backwards" },
    );
    playOpening(460);
    return () => {
      rise.cancel();
      player.cancel();
    };
  }, [player]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- turns the two faces this render mounted with the Web Animations API
  useLayoutEffect(() => {
    if (turn === null) return;
    const incoming = incomingRef.current;
    const outgoing = outgoingRef.current;
    if (incoming === null || outgoing === null || reducedMotion()) {
      land();
      return;
    }
    const frames = turnKeyframes(turn.forward);
    const timing = { duration: TURN_MS, easing: TURN_EASING, fill: "both" as const };
    const animations = [
      incoming.animate([...frames.in], timing),
      outgoing.animate([...frames.out], timing),
    ];
    let live = true;
    Promise.all(animations.map((animation) => animation.finished)).then(
      () => {
        if (live) land();
      },
      () => undefined,
    );
    // A new turn mid-way lands this one at rest before it starts.
    return () => {
      live = false;
      for (const animation of animations) animation.cancel();
    };
  }, [turn]);

  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- listens to the pointer on the stage, outside React, only for a direction that tilts
  useEffect(() => {
    const stage = stageRef.current;
    if (stage === null || motion !== "tilt") return;
    return attachPointerTilt(
      stage,
      () => screenRef.current?.querySelector<HTMLElement>('[data-dp~="scene"]') ?? null,
    );
  }, [motion, stageRef]);

  if (shown === undefined) return null;
  const { direction } = shown;
  const leaving = turn === null ? undefined : directions[turn.from];
  return (
    <div className="relative w-[min(92vw,1120px,calc((88dvh-11rem)*1.6))] [perspective:1800px]">
      <Button
        aria-label="Close"
        size="icon-xs"
        variant="media-close"
        className="absolute -top-10 right-0 z-20"
        onClick={onClose}
      >
        <XIcon />
      </Button>
      <div ref={riseRef} className="transform-3d">
        <div
          ref={stageRef}
          tabIndex={-1}
          role="group"
          aria-roledescription="carousel"
          aria-label={`${direction.name}, ${index + 1} of ${directions.length}`}
          className="@container relative rounded-xl outline-none transform-3d"
        >
          {leaving === undefined ? null : (
            <div
              key={`leaving-${turn?.from}`}
              ref={outgoingRef}
              className="absolute inset-0 overflow-hidden rounded-xl shadow-2xl backface-hidden"
            >
              <DirectionScreen shown={leaving} />
            </div>
          )}
          <div
            key={index}
            ref={incomingRef}
            className="relative overflow-hidden rounded-xl shadow-2xl ring-1 ring-white/10 backface-hidden"
          >
            <DirectionScreen shown={shown} rootRef={screenRef} />
          </div>
        </div>
      </div>
      <p aria-live="polite" className="sr-only">
        {`${index + 1} of ${directions.length}, ${direction.name}`}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-3 text-white">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="m-0 flex items-baseline gap-2 font-medium text-base">
            {direction.name}
            {direction.skill === undefined ? null : (
              <span className="font-normal text-white/55 text-xs">
                {SKILL_LABEL[direction.skill]}
              </span>
            )}
          </p>
          <p className="m-0 text-sm text-white/70">{direction.idea}</p>
          <p className="m-0 text-white/55 text-xs">
            {[
              MOTION_WORDS[shown.motion],
              COMPOSITION_WORDS[shown.composition],
              MATERIAL_WORDS[shown.material],
              faceNote(shown),
            ].join(" · ")}
          </p>
        </div>
        <ul aria-label="Colours" className="m-0 flex list-none gap-1.5 p-0">
          {SWATCHES.map(([role, label]) => (
            <li
              key={role}
              aria-label={`${label} ${direction.colors[role]}`}
              className="size-5 rounded-full ring-1 ring-white/25"
              style={{ background: direction.colors[role] }}
            />
          ))}
        </ul>
        <div className="flex items-center gap-1.5">
          <Button
            aria-label="Previous direction"
            size="icon-sm"
            variant="overlay"
            onClick={() => onGo(-1)}
          >
            <ChevronLeftIcon />
          </Button>
          <Button
            aria-label="Next direction"
            size="icon-sm"
            variant="overlay"
            onClick={() => onGo(1)}
          >
            <ChevronRightIcon />
          </Button>
          <Button size="sm" variant="overlay" onClick={play}>
            <PlayIcon />
            Play again
          </Button>
          <Button size="sm" disabled={answering} onClick={() => onPick(index)}>
            Use {direction.name}
          </Button>
        </div>
      </div>
      <ul aria-label="Directions" className="m-0 mt-4 flex list-none gap-2 p-0">
        {directions.map((other, otherIndex) => (
          <li key={`${other.direction.name}:${other.direction.colors.accent}`}>
            <button
              type="button"
              aria-current={otherIndex === index ? "true" : undefined}
              aria-label={`Show ${other.direction.name}`}
              className="block w-28 overflow-hidden rounded-md opacity-55 outline-none ring-1 ring-white/20 transition-opacity hover:opacity-90 focus-visible:opacity-100 focus-visible:ring-white aria-[current=true]:opacity-100 aria-[current=true]:ring-white/70"
              onClick={() => onGo(otherIndex - index)}
            >
              <DirectionScreen shown={other} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One direction at a time, large, with a turn in depth between them. */
export function DesignViewer({
  directions,
  start,
  answering,
  onPick,
  onClose,
}: {
  readonly directions: ReadonlyArray<ShownDirection>;
  readonly start: number;
  readonly answering: boolean;
  readonly onPick: (index: number) => void;
  readonly onClose: () => void;
}) {
  const [index, setIndex] = useState(() => wrapIndex(start, directions.length));
  const [turn, setTurn] = useState<Turn | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [player] = useState(createMotionPlayer);

  const go = (step: number) => {
    const next = wrapIndex(index + step, directions.length);
    if (next === index) return;
    player.cancel();
    setTurn({ from: index, forward: step > 0 });
    setIndex(next);
  };

  // On the popup, so the arrows work wherever focus sits inside the dialog.
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.repeat) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      go(1);
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      go(-1);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogPopup
        variant="media"
        showCloseButton={false}
        bottomStickOnMobile={false}
        className="row-start-1"
        initialFocus={stageRef}
        onKeyDown={onKeyDown}
      >
        <DialogTitle className="sr-only">Design directions</DialogTitle>
        <Stage
          directions={directions}
          index={index}
          turn={turn}
          answering={answering}
          stageRef={stageRef}
          player={player}
          onGo={go}
          onLanded={() => setTurn(null)}
          onPick={onPick}
          onClose={onClose}
        />
      </DialogPopup>
    </Dialog>
  );
}
