import type { SVGProps } from "react";

import { OzoneMark } from "../ozone/OzoneMark";

// ozone-seam: every place that shows upstream's wordmark shows the Ozone mark instead.
export function T3Wordmark(props: SVGProps<SVGSVGElement>) {
  return <OzoneMark {...props} />;
}
