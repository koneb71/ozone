import type {
  OzoneDesignDirection,
  OzoneDesignFace,
  OzoneDesignProposal,
} from "@t3tools/contracts";
import { PaletteIcon } from "lucide-react";
import type { CSSProperties } from "react";

import type { ComposerBannerStackItem } from "~/components/chat/ComposerBannerStack";
import { Button } from "~/components/ui/button";

// The faces are never fetched: Ozone sends nothing to a font service. One that is not installed
// on this device shows in a face of the same kind.
const FALLBACK: Record<OzoneDesignFace["style"], string> = {
  serif: "ui-serif, Georgia, serif",
  sans: "ui-sans-serif, system-ui, sans-serif",
  mono: "ui-monospace, Menlo, monospace",
  display: "ui-sans-serif, system-ui, sans-serif",
  script: "cursive",
};

const fontOf = (face: OzoneDesignFace): CSSProperties => ({
  fontFamily: `"${face.family.replaceAll('"', "")}", ${FALLBACK[face.style]}`,
});

const SWATCHES = [
  ["background", "Background"],
  ["surface", "Surface"],
  ["text", "Text"],
  ["muted", "Muted text"],
  ["accent", "Accent"],
  ["accentText", "Text on the accent"],
] as const;

/** The direction's first screen, drawn small in its own colours and faces. */
function FirstScreen({ direction }: { readonly direction: OzoneDesignDirection }) {
  const { colors } = direction;
  return (
    <div
      aria-hidden="true"
      className="flex aspect-[16/10] flex-col overflow-hidden rounded-md border border-border/60 p-3"
      style={{ background: colors.background, color: colors.text }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1">
          <span className="size-2 rounded-sm" style={{ background: colors.accent }} />
          <span className="h-1 w-6 rounded-full" style={{ background: colors.text }} />
        </span>
        <span className="flex shrink-0 gap-1">
          <span className="h-1 w-4 rounded-full" style={{ background: colors.muted }} />
          <span className="h-1 w-4 rounded-full" style={{ background: colors.muted }} />
        </span>
      </div>
      <div className="mt-auto flex min-w-0 flex-col gap-1.5">
        <span className="line-clamp-2 text-lg leading-tight" style={fontOf(direction.display)}>
          {direction.name}
        </span>
        <span
          className="line-clamp-2 text-3xs leading-snug"
          style={{ ...fontOf(direction.body), color: colors.muted }}
        >
          {direction.idea}
        </span>
        <span className="flex items-center gap-1.5" style={fontOf(direction.body)}>
          <span
            className="rounded px-2 py-0.5 font-medium text-4xs"
            style={{ background: colors.accent, color: colors.accentText }}
          >
            Get started
          </span>
          <span
            className="rounded px-2 py-0.5 text-4xs"
            style={{ background: colors.surface, color: colors.text }}
          >
            Learn more
          </span>
        </span>
      </div>
    </div>
  );
}

function Direction({
  direction,
  disabled,
  onPick,
}: {
  readonly direction: OzoneDesignDirection;
  readonly disabled: boolean;
  readonly onPick: () => void;
}) {
  return (
    <li
      aria-label={direction.name}
      className="flex min-w-0 flex-col gap-2 rounded-lg border border-border/70 bg-card/60 p-2"
    >
      <FirstScreen direction={direction} />
      <div className="flex min-w-0 flex-col gap-1 px-0.5">
        <p className="m-0 truncate text-foreground text-xs">{direction.mood}</p>
        <ul aria-label="Colours" className="m-0 flex list-none gap-1 p-0">
          {SWATCHES.map(([role, label]) => (
            <li
              key={role}
              aria-label={`${label} ${direction.colors[role]}`}
              className="size-4 rounded-full border border-border/70"
              style={{ background: direction.colors[role] }}
            />
          ))}
        </ul>
        <p className="m-0 truncate text-muted-foreground text-xs">
          {direction.display.family} · {direction.body.family}
        </p>
        <p className="m-0 line-clamp-2 text-muted-foreground text-xs">{direction.layout}</p>
      </div>
      <Button className="mt-auto" disabled={disabled} size="xs" variant="outline" onClick={onPick}>
        Use {direction.name}
      </Button>
    </li>
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
    description: "The lead plans from your pick. For other directions, say what you want.",
    actions: (
      <Button disabled={answering} size="xs" variant="ghost" onClick={() => onAnswer(null)}>
        Let the lead choose
      </Button>
    ),
    children: (
      <ul
        aria-label="Design directions"
        className="m-0 grid list-none auto-cols-[minmax(13rem,1fr)] grid-flow-col gap-2 overflow-x-auto p-0 pb-1"
      >
        {proposal.directions.map((direction, index) => (
          <Direction
            key={`${direction.name}:${direction.colors.background}:${direction.colors.accent}`}
            direction={direction}
            disabled={answering}
            onPick={() => onAnswer(index)}
          />
        ))}
      </ul>
    ),
    collapsible: { defaultOpen: true, what: "directions" },
  };
}
