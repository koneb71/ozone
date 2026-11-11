import type { SVGProps } from "react";

/** The Ozone mark: a ring with one atom on its orbit. Inherits the text colour. */
export function OzoneMark(props: SVGProps<SVGSVGElement>) {
  return (
    <svg {...props} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <circle cx="30" cy="34" r="19" fill="none" stroke="currentColor" strokeWidth="9" />
      <circle cx="51" cy="13" r="7" fill="currentColor" />
    </svg>
  );
}
