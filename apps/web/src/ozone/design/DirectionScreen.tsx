import type { CSSProperties, ReactNode, Ref } from "react";
import { Fragment } from "react";

import { cn } from "~/lib/utils";

import { headlineSize, materialStyle, type ShownDirection } from "./designVocabulary.logic";

// The screen is drawn in `cqi` of its outer wrapper, so a card and the large view show the same
// screen at any width; those lengths are the drawing's own, not the app's spacing scale.
// Elements a motion moves (`data-dp`) carry no transform of their own: a resting offset sits on
// a wrapper, so a motion's last frame is the screen at rest.
const cq = (value: number) => `${value}cqi`;

const panel: CSSProperties = {
  background: "var(--dp-panel)",
  borderRadius: "var(--dp-radius)",
  boxShadow: "var(--dp-panel-ring), var(--dp-panel-shadow)",
};

const label: CSSProperties = { fontFamily: "var(--dp-label)", fontSize: cq(1.15), opacity: 0.7 };

const bar = (width: string, height = 0.55): CSSProperties => ({
  width,
  height: cq(height),
  borderRadius: 999,
  background: "var(--dp-muted)",
  opacity: 0.45,
});

function Nav({ shown }: { readonly shown: ShownDirection }) {
  return (
    <div
      className="absolute flex items-center justify-between"
      style={{ left: cq(5), right: cq(5), top: cq(3.4) }}
    >
      <span className="flex items-center" style={{ gap: cq(0.9) }}>
        <span
          style={{
            width: cq(1.3),
            height: cq(1.3),
            background: "var(--dp-accent)",
            borderRadius: "var(--dp-radius)",
          }}
        />
        <span
          className="leading-none"
          style={{
            fontSize: cq(1.7),
            fontFamily: "var(--dp-display)",
            fontWeight: "var(--dp-display-weight)",
          }}
        >
          {shown.copy.brand}
        </span>
      </span>
      <span className="flex items-center" style={{ gap: cq(2) }}>
        <span style={bar(cq(5), 0.45)} />
        <span style={bar(cq(4), 0.45)} />
        <span style={bar(cq(6), 0.45)} />
        <span
          style={{
            width: cq(8),
            height: cq(2.6),
            borderRadius: "var(--dp-radius)",
            boxShadow: "inset 0 0 0 1px var(--dp-text)",
          }}
        />
      </span>
    </div>
  );
}

function Headline({
  shown,
  align = "left",
}: {
  readonly shown: ShownDirection;
  readonly align?: "left" | "center";
}) {
  const seen = new Map<string, number>();
  const words = shown.copy.headline
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => {
      const occurrence = (seen.get(word) ?? 0) + 1;
      seen.set(word, occurrence);
      return { word, key: `${word}:${occurrence}` };
    });
  const last = words.at(-1)?.key;
  return (
    <div
      className="m-0 text-balance"
      style={{
        fontFamily: "var(--dp-display)",
        fontWeight: "var(--dp-display-weight)",
        fontSize: cq(headlineSize(shown.composition, shown.copy.headline)),
        lineHeight: 1.02,
        letterSpacing: "-0.03em",
        textAlign: align,
      }}
    >
      {words.map(({ word, key }) => (
        <Fragment key={key}>
          <span
            className="inline-block overflow-hidden align-bottom"
            style={{ paddingBottom: "0.12em", marginBottom: "-0.12em", perspective: cq(40) }}
          >
            <span data-dp="word" className="inline-block origin-bottom">
              {word}
            </span>
          </span>
          {key === last ? null : " "}
        </Fragment>
      ))}
    </div>
  );
}

function Lede({
  shown,
  style,
}: {
  readonly shown: ShownDirection;
  readonly style?: CSSProperties;
}) {
  return (
    <p
      data-dp="lede"
      className="m-0"
      style={{ color: "var(--dp-muted)", fontSize: cq(1.65), lineHeight: 1.45, ...style }}
    >
      {shown.copy.lede}
    </p>
  );
}

function Cta({ shown, link = false }: { readonly shown: ShownDirection; readonly link?: boolean }) {
  return link ? (
    <span
      data-dp="cta"
      className="inline-block underline"
      style={{
        fontSize: cq(1.6),
        textDecorationColor: "var(--dp-accent)",
        textDecorationThickness: cq(0.15),
        textUnderlineOffset: cq(0.6),
      }}
    >
      {shown.copy.cta} →
    </span>
  ) : (
    <span
      data-dp="cta"
      className="inline-block font-medium leading-none"
      style={{
        padding: `${cq(1.05)} ${cq(2.2)}`,
        fontSize: cq(1.5),
        background: "var(--dp-accent)",
        color: "var(--dp-accent-text)",
        borderRadius: "var(--dp-radius)",
      }}
    >
      {shown.copy.cta}
    </span>
  );
}

const SLOTS = ["first", "second", "third"] as const;

/** The proof points the cards show, in fixed slots; a slot without one draws a placeholder line. */
const factsOf = (shown: ShownDirection, count: 1 | 2 | 3) =>
  SLOTS.slice(0, count).map((slot, index) => ({
    slot,
    index,
    fact: shown.copy.facts?.[index] ?? null,
  }));

function Card({
  fact,
  index,
  className,
  style,
}: {
  readonly fact: string | null;
  readonly index: number;
  readonly className?: string;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      data-dp="card"
      className={cn("flex flex-col justify-between", className)}
      style={{ ...panel, gap: cq(0.8), padding: cq(1.4), ...style }}
    >
      <span style={label}>{String(index + 1).padStart(2, "0")}</span>
      {fact === null ? (
        <span style={bar("75%", 0.6)} />
      ) : (
        <span className="leading-tight" style={{ fontSize: cq(1.35) }}>
          {fact}
        </span>
      )}
    </div>
  );
}

/** An abstract poster in the direction's colours, standing in for a photograph. */
function Art({
  round = false,
  style,
}: {
  readonly round?: boolean;
  readonly style?: CSSProperties;
}) {
  return (
    <div
      className="relative overflow-hidden"
      style={{
        borderRadius: "var(--dp-radius)",
        background:
          "linear-gradient(165deg, var(--dp-surface) 0%, color-mix(in oklab, var(--dp-muted) 55%, var(--dp-surface)) 100%)",
        ...style,
      }}
    >
      <span
        className="absolute rounded-full"
        style={{
          top: "18%",
          left: "52%",
          width: "42%",
          aspectRatio: "1",
          background: "var(--dp-accent)",
        }}
      />
      <span
        className="absolute bottom-0"
        style={{
          left: "14%",
          right: "14%",
          height: "48%",
          background: "var(--dp-bg)",
          borderRadius: round
            ? "50% 50% 0 0 / 60% 60% 0 0"
            : "var(--dp-radius) var(--dp-radius) 0 0",
        }}
      />
    </div>
  );
}

/** An app window: a top bar, a side list, tiles and a chart. */
function AppWindow({
  shown,
  style,
}: {
  readonly shown: ShownDirection;
  readonly style: CSSProperties;
}) {
  return (
    <div
      data-dp="visual layer"
      className="origin-bottom absolute flex flex-col overflow-hidden"
      style={{ ...panel, ...style }}
    >
      <div className="flex items-center" style={{ gap: cq(0.6), padding: `${cq(1.2)} ${cq(1.6)}` }}>
        {SLOTS.map((slot) => (
          <span
            key={slot}
            className="rounded-full"
            style={{ width: cq(0.8), height: cq(0.8), background: "var(--dp-text)", opacity: 0.35 }}
          />
        ))}
      </div>
      <div
        className="grid flex-1 grid-cols-[1fr_2.4fr]"
        style={{ gap: cq(1.4), padding: `0 ${cq(1.6)} ${cq(1.6)}` }}
      >
        <div className="flex flex-col" style={{ gap: cq(1), paddingTop: cq(0.5) }}>
          <span style={bar("80%")} />
          <span style={bar("60%")} />
          <span style={bar("70%")} />
          <span style={bar("50%")} />
        </div>
        <div className="flex flex-col" style={{ gap: cq(1.4) }}>
          <div className="grid grid-cols-3" style={{ gap: cq(1.2) }}>
            {factsOf(shown, 3).map(({ slot, index, fact }) => (
              <Card key={slot} fact={fact} index={index} style={{ minHeight: cq(7) }} />
            ))}
          </div>
          <svg
            viewBox="0 0 100 30"
            preserveAspectRatio="none"
            className="w-full"
            style={{ height: cq(12) }}
          >
            <path
              d="M0 26 C 14 24, 18 12, 32 15 S 52 25, 64 12 S 86 4, 100 6"
              fill="none"
              stroke="var(--dp-accent)"
              strokeWidth="1.6"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>
    </div>
  );
}

function Monument({ shown }: { readonly shown: ShownDirection }) {
  return (
    <>
      <div
        className="absolute"
        style={{ top: cq(-12), right: cq(-9), width: cq(40), height: cq(40), opacity: 0.9 }}
      >
        <div
          data-dp="visual layer"
          className="origin-bottom size-full rounded-full"
          style={{ background: "var(--dp-accent)" }}
        />
      </div>
      <div data-dp="layer" className="absolute" style={{ left: cq(5), right: cq(5), top: cq(11) }}>
        <Headline shown={shown} />
      </div>
      <div
        className="absolute flex items-end justify-between transform-3d"
        style={{ left: cq(5), right: cq(5), bottom: cq(4.5), gap: cq(4) }}
      >
        <div
          data-dp="layer"
          className="flex flex-col items-start"
          style={{ maxWidth: cq(36), gap: cq(2) }}
        >
          <Lede shown={shown} />
          <Cta shown={shown} />
        </div>
        <div className="flex transform-3d" style={{ gap: cq(1.2) }}>
          {factsOf(shown, 3).map(({ slot, index, fact }) => (
            <Card key={slot} fact={fact} index={index} style={{ width: cq(13), height: cq(11) }} />
          ))}
        </div>
      </div>
    </>
  );
}

function Split({ shown }: { readonly shown: ShownDirection }) {
  const [first, second] = factsOf(shown, 2);
  return (
    <div
      className="absolute grid grid-cols-[1.08fr_1fr] items-center transform-3d"
      style={{ left: cq(5), right: cq(5), top: cq(10), bottom: cq(5), gap: cq(5) }}
    >
      <div data-dp="layer" className="flex flex-col items-start" style={{ gap: cq(2.2) }}>
        <Headline shown={shown} />
        <Lede shown={shown} style={{ maxWidth: cq(40) }} />
        <Cta shown={shown} />
      </div>
      <div className="relative h-full transform-3d">
        <div
          data-dp="visual layer"
          className="origin-bottom absolute inset-0"
          style={{ ...panel, padding: cq(1) }}
        >
          <Art round style={{ width: "100%", height: "100%" }} />
        </div>
        <div
          className="absolute transform-3d"
          style={{ left: cq(-4), bottom: cq(5), width: cq(17) }}
        >
          <Card fact={first?.fact ?? null} index={0} style={{ height: cq(9) }} />
        </div>
        <div className="absolute transform-3d" style={{ top: cq(4), right: cq(-2), width: cq(14) }}>
          <Card fact={second?.fact ?? null} index={1} style={{ height: cq(8) }} />
        </div>
      </div>
    </div>
  );
}

function Centred({ shown }: { readonly shown: ShownDirection }) {
  return (
    <>
      <div
        data-dp="layer"
        className="absolute flex flex-col items-center"
        style={{ left: cq(12), right: cq(12), top: cq(10), gap: cq(1.8) }}
      >
        <Headline shown={shown} align="center" />
        <Lede shown={shown} style={{ maxWidth: cq(52), textAlign: "center" }} />
        <Cta shown={shown} />
      </div>
      <AppWindow shown={shown} style={{ left: cq(9), right: cq(9), top: cq(38), height: cq(34) }} />
    </>
  );
}

function Bento({ shown }: { readonly shown: ShownDirection }) {
  const [first, second, third] = factsOf(shown, 3);
  return (
    <>
      <div
        data-dp="layer"
        className="absolute flex flex-col items-start"
        style={{ top: cq(10), left: cq(5), width: cq(50), gap: cq(1.6) }}
      >
        <Headline shown={shown} />
        <Lede shown={shown} />
      </div>
      <div className="absolute transform-3d" style={{ top: cq(11), right: cq(5), width: cq(34) }}>
        <Card fact={first?.fact ?? null} index={0} style={{ height: cq(15) }} />
      </div>
      <div
        className="absolute grid grid-cols-6 grid-rows-2 transform-3d"
        style={{ left: cq(5), right: cq(5), top: cq(31), bottom: cq(4.5), gap: cq(1.4) }}
      >
        <div
          data-dp="visual layer"
          className="origin-bottom col-span-3 row-span-2"
          style={{ ...panel, padding: cq(0.8) }}
        >
          <Art style={{ width: "100%", height: "100%" }} />
        </div>
        <div
          data-dp="card"
          className="col-span-3 flex items-end justify-between"
          style={{
            ...panel,
            padding: cq(1.6),
            background: "var(--dp-accent)",
            color: "var(--dp-accent-text)",
          }}
        >
          <span
            data-dp="cta"
            className="inline-block max-w-[70%] leading-tight"
            style={{ fontSize: cq(1.6) }}
          >
            {shown.copy.cta}
          </span>
          <span style={{ fontSize: cq(2.4) }}>→</span>
        </div>
        <Card fact={second?.fact ?? null} index={1} className="col-span-2" />
        <Card fact={third?.fact ?? null} index={2} />
      </div>
    </>
  );
}

const CASCADE_OFFSET = [
  "translate3d(-7cqi, -6cqi, -12cqi)",
  "translate3d(-3.5cqi, -3cqi, -6cqi)",
  "none",
] as const;

function Cascade({ shown }: { readonly shown: ShownDirection }) {
  return (
    <>
      <div
        data-dp="layer"
        className="absolute flex flex-col items-start"
        style={{ top: cq(13), left: cq(5), width: cq(42), gap: cq(2) }}
      >
        <Headline shown={shown} />
        <Lede shown={shown} />
        <Cta shown={shown} />
      </div>
      <div
        className="absolute transform-3d"
        style={{
          top: cq(17),
          right: cq(7),
          width: cq(38),
          height: cq(38),
          transform: "rotateY(-16deg) rotateX(6deg)",
        }}
      >
        {factsOf(shown, 3).map(({ slot, index, fact }) => (
          <div
            key={slot}
            className="absolute inset-0 transform-3d"
            style={{ transform: CASCADE_OFFSET[index] }}
          >
            <div
              data-dp={index === 2 ? "card visual" : "card"}
              className="origin-bottom flex size-full flex-col"
              style={{ ...panel, gap: cq(1.4), padding: cq(1.6) }}
            >
              {index === 2 ? (
                <>
                  <Art round style={{ height: "60%" }} />
                  <span style={label}>03</span>
                  {fact === null ? (
                    <span style={bar("50%", 0.6)} />
                  ) : (
                    <span className="leading-tight" style={{ fontSize: cq(1.5) }}>
                      {fact}
                    </span>
                  )}
                </>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function Ledger({ shown }: { readonly shown: ShownDirection }) {
  return (
    <>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundImage:
            "linear-gradient(var(--dp-hairline) 1px, transparent 1px), linear-gradient(90deg, var(--dp-hairline) 1px, transparent 1px)",
          backgroundSize: `${cq(6.25)} ${cq(6.25)}`,
        }}
      />
      <div
        data-dp="layer"
        className="absolute flex flex-col items-start"
        style={{ top: cq(12.5), left: cq(6.25), width: cq(50), gap: cq(2) }}
      >
        <span
          className="uppercase"
          style={{ ...label, letterSpacing: "0.2em", color: "var(--dp-muted)" }}
        >
          {shown.copy.brand} / 01
        </span>
        <Headline shown={shown} />
        <Lede shown={shown} style={{ maxWidth: cq(42) }} />
        <Cta shown={shown} />
      </div>
      <div
        className="absolute grid grid-rows-4 transform-3d"
        style={{ top: cq(12.5), right: cq(6.25), bottom: cq(6.25), width: cq(31.25), gap: cq(0.6) }}
      >
        {factsOf(shown, 3).map(({ slot, index, fact }) => (
          <Card key={slot} fact={fact} index={index} />
        ))}
        <div data-dp="visual layer" className="origin-bottom relative" style={panel}>
          <svg
            viewBox="0 0 100 40"
            className="absolute inset-0 size-full"
            preserveAspectRatio="xMidYMid meet"
          >
            <circle
              cx="50"
              cy="20"
              r="14"
              fill="none"
              stroke="var(--dp-accent)"
              strokeWidth="1.2"
            />
            <path
              d="M8 20 H92 M50 2 V38"
              stroke="var(--dp-muted)"
              strokeWidth="0.6"
              strokeDasharray="2 2"
            />
          </svg>
        </div>
      </div>
    </>
  );
}

function Manuscript({ shown }: { readonly shown: ShownDirection }) {
  const [first, second] = factsOf(shown, 2);
  return (
    <>
      <div
        data-dp="layer"
        className="absolute flex flex-col items-start"
        style={{ top: cq(12), left: cq(7), width: cq(44), gap: cq(2.2) }}
      >
        <Headline shown={shown} />
        <span style={{ width: cq(7), height: cq(0.3), background: "var(--dp-accent)" }} />
        <Lede shown={shown} style={{ maxWidth: cq(38) }} />
        <Cta shown={shown} link />
      </div>
      <div
        className="absolute transform-3d"
        style={{ top: cq(11), right: cq(7), bottom: cq(-4), width: cq(30) }}
      >
        <div data-dp="visual layer" className="origin-bottom size-full">
          <Art round style={{ width: "100%", height: "100%" }} />
        </div>
        <div className="absolute transform-3d" style={{ top: cq(8), left: cq(-9), width: cq(15) }}>
          <Card fact={first?.fact ?? null} index={0} style={{ height: cq(8) }} />
        </div>
        <div
          className="absolute transform-3d"
          style={{ bottom: cq(12), left: cq(-5), width: cq(13) }}
        >
          <Card fact={second?.fact ?? null} index={1} style={{ height: cq(7) }} />
        </div>
      </div>
    </>
  );
}

const COMPOSITION: Record<
  ShownDirection["composition"],
  (props: { readonly shown: ShownDirection }) => ReactNode
> = {
  monument: Monument,
  split: Split,
  centred: Centred,
  bento: Bento,
  cascade: Cascade,
  ledger: Ledger,
  manuscript: Manuscript,
};

/** The direction's first screen, drawn in its own colours, faces, composition and material. */
export function DirectionScreen({
  shown,
  className,
  rootRef,
}: {
  readonly shown: ShownDirection;
  readonly className?: string;
  readonly rootRef?: Ref<HTMLDivElement>;
}) {
  const Body = COMPOSITION[shown.composition];
  return (
    <div aria-hidden="true" className={cn("@container w-full", className)}>
      <div
        ref={rootRef}
        className="relative aspect-[16/10] w-full overflow-hidden select-none"
        style={{
          ...materialStyle(shown),
          background: "var(--dp-ground)",
          color: "var(--dp-text)",
          fontFamily: "var(--dp-body)",
          perspective: cq(140),
        }}
      >
        <div
          data-dp="scene"
          className="absolute inset-0 transform-3d"
          style={{ transformOrigin: "50% 60%" }}
        >
          <Nav shown={shown} />
          <Body shown={shown} />
        </div>
        <div
          data-dp="sheen"
          className="pointer-events-none absolute inset-y-0 left-0 w-1/3 opacity-0"
          style={{
            background: "linear-gradient(90deg, transparent, rgb(255 255 255 / 0.6), transparent)",
          }}
        />
      </div>
    </div>
  );
}
