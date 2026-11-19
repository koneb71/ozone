import type { OzoneDesignFaceFamily } from "@t3tools/contracts";

import albertSansUrl from "@fontsource-variable/albert-sans/files/albert-sans-latin-wght-normal.woff2?url";
import anybodyUrl from "@fontsource-variable/anybody/files/anybody-latin-wght-normal.woff2?url";
import archivoUrl from "@fontsource-variable/archivo/files/archivo-latin-wght-normal.woff2?url";
import besleyUrl from "@fontsource-variable/besley/files/besley-latin-wght-normal.woff2?url";
import bricolageGrotesqueUrl from "@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url";
import chivoUrl from "@fontsource-variable/chivo/files/chivo-latin-wght-normal.woff2?url";
import ebGaramondUrl from "@fontsource-variable/eb-garamond/files/eb-garamond-latin-wght-normal.woff2?url";
import epilogueUrl from "@fontsource-variable/epilogue/files/epilogue-latin-wght-normal.woff2?url";
import familjenGroteskUrl from "@fontsource-variable/familjen-grotesk/files/familjen-grotesk-latin-wght-normal.woff2?url";
import figtreeUrl from "@fontsource-variable/figtree/files/figtree-latin-wght-normal.woff2?url";
import frauncesUrl from "@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url";
import funnelDisplayUrl from "@fontsource-variable/funnel-display/files/funnel-display-latin-wght-normal.woff2?url";
import funnelSansUrl from "@fontsource-variable/funnel-sans/files/funnel-sans-latin-wght-normal.woff2?url";
import gabaritoUrl from "@fontsource-variable/gabarito/files/gabarito-latin-wght-normal.woff2?url";
import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";
import hankenGroteskUrl from "@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2?url";
import hostGroteskUrl from "@fontsource-variable/host-grotesk/files/host-grotesk-latin-wght-normal.woff2?url";
import ibmPlexSansUrl from "@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url";
import instrumentSansUrl from "@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2?url";
import instrumentSerifUrl from "@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2?url";
import jostUrl from "@fontsource-variable/jost/files/jost-latin-wght-normal.woff2?url";
import libreFranklinUrl from "@fontsource-variable/libre-franklin/files/libre-franklin-latin-wght-normal.woff2?url";
import literataUrl from "@fontsource-variable/literata/files/literata-latin-wght-normal.woff2?url";
import loraUrl from "@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url";
import manropeUrl from "@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url";
import monaSansUrl from "@fontsource-variable/mona-sans/files/mona-sans-latin-wght-normal.woff2?url";
import newsreaderUrl from "@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2?url";
import nunitoUrl from "@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url";
import nunitoSansUrl from "@fontsource-variable/nunito-sans/files/nunito-sans-latin-wght-normal.woff2?url";
import onestUrl from "@fontsource-variable/onest/files/onest-latin-wght-normal.woff2?url";
import outfitUrl from "@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url";
import redHatDisplayUrl from "@fontsource-variable/red-hat-display/files/red-hat-display-latin-wght-normal.woff2?url";
import redHatTextUrl from "@fontsource-variable/red-hat-text/files/red-hat-text-latin-wght-normal.woff2?url";
import redditSansUrl from "@fontsource-variable/reddit-sans/files/reddit-sans-latin-wght-normal.woff2?url";
import rethinkSansUrl from "@fontsource-variable/rethink-sans/files/rethink-sans-latin-wght-normal.woff2?url";
import suseUrl from "@fontsource-variable/suse/files/suse-latin-wght-normal.woff2?url";
import schibstedGroteskUrl from "@fontsource-variable/schibsted-grotesk/files/schibsted-grotesk-latin-wght-normal.woff2?url";
import soraUrl from "@fontsource-variable/sora/files/sora-latin-wght-normal.woff2?url";
import sourceSerif4Url from "@fontsource-variable/source-serif-4/files/source-serif-4-latin-wght-normal.woff2?url";
import urbanistUrl from "@fontsource-variable/urbanist/files/urbanist-latin-wght-normal.woff2?url";
import vollkornUrl from "@fontsource-variable/vollkorn/files/vollkorn-latin-wght-normal.woff2?url";
import workSansUrl from "@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2?url";
import zillaSlabUrl from "@fontsource/zilla-slab/files/zilla-slab-latin-400-normal.woff2?url";

import { registeredName } from "./designVocabulary.logic";

// The latin cut of each face the taste library pairs, built into the client: previews fetch nothing
// from a font service, and a remote client loads them from its own origin.
const FACES: Record<OzoneDesignFaceFamily, { readonly url: string; readonly weight: string }> = {
  "Albert Sans": { url: albertSansUrl, weight: "100 900" },
  Anybody: { url: anybodyUrl, weight: "100 900" },
  Archivo: { url: archivoUrl, weight: "100 900" },
  Besley: { url: besleyUrl, weight: "100 900" },
  "Bricolage Grotesque": { url: bricolageGrotesqueUrl, weight: "100 900" },
  Chivo: { url: chivoUrl, weight: "100 900" },
  "EB Garamond": { url: ebGaramondUrl, weight: "100 900" },
  Epilogue: { url: epilogueUrl, weight: "100 900" },
  "Familjen Grotesk": { url: familjenGroteskUrl, weight: "100 900" },
  Figtree: { url: figtreeUrl, weight: "100 900" },
  Fraunces: { url: frauncesUrl, weight: "100 900" },
  "Funnel Display": { url: funnelDisplayUrl, weight: "100 900" },
  "Funnel Sans": { url: funnelSansUrl, weight: "100 900" },
  Gabarito: { url: gabaritoUrl, weight: "100 900" },
  Geist: { url: geistUrl, weight: "100 900" },
  "Hanken Grotesk": { url: hankenGroteskUrl, weight: "100 900" },
  "Host Grotesk": { url: hostGroteskUrl, weight: "100 900" },
  "IBM Plex Sans": { url: ibmPlexSansUrl, weight: "100 900" },
  "Instrument Sans": { url: instrumentSansUrl, weight: "100 900" },
  "Instrument Serif": { url: instrumentSerifUrl, weight: "400" },
  Jost: { url: jostUrl, weight: "100 900" },
  "Libre Franklin": { url: libreFranklinUrl, weight: "100 900" },
  Literata: { url: literataUrl, weight: "100 900" },
  Lora: { url: loraUrl, weight: "100 900" },
  Manrope: { url: manropeUrl, weight: "100 900" },
  "Mona Sans": { url: monaSansUrl, weight: "100 900" },
  Newsreader: { url: newsreaderUrl, weight: "100 900" },
  Nunito: { url: nunitoUrl, weight: "100 900" },
  "Nunito Sans": { url: nunitoSansUrl, weight: "100 900" },
  Onest: { url: onestUrl, weight: "100 900" },
  Outfit: { url: outfitUrl, weight: "100 900" },
  "Red Hat Display": { url: redHatDisplayUrl, weight: "100 900" },
  "Red Hat Text": { url: redHatTextUrl, weight: "100 900" },
  "Reddit Sans": { url: redditSansUrl, weight: "100 900" },
  "Rethink Sans": { url: rethinkSansUrl, weight: "100 900" },
  SUSE: { url: suseUrl, weight: "100 900" },
  "Schibsted Grotesk": { url: schibstedGroteskUrl, weight: "100 900" },
  Sora: { url: soraUrl, weight: "100 900" },
  "Source Serif 4": { url: sourceSerif4Url, weight: "100 900" },
  Urbanist: { url: urbanistUrl, weight: "100 900" },
  Vollkorn: { url: vollkornUrl, weight: "100 900" },
  "Work Sans": { url: workSansUrl, weight: "100 900" },
  "Zilla Slab": { url: zillaSlabUrl, weight: "400" },
};

const loading = new Map<string, Promise<void>>();

const load = (family: string): Promise<void> => {
  const face = FACES[family as OzoneDesignFaceFamily] as
    | (typeof FACES)[OzoneDesignFaceFamily]
    | undefined;
  if (face === undefined) return Promise.resolve();
  const font = new FontFace(registeredName(family), `url(${face.url}) format("woff2")`, {
    weight: face.weight,
    display: "block",
  });
  return font.load().then(
    (loaded) => {
      document.fonts.add(loaded);
    },
    // A face that fails to load leaves the preview in its fallback; a later proposal tries again.
    () => {
      loading.delete(family);
    },
  );
};

/** Loads the faces once per session; settles when each has loaded or failed. */
export function ensureFaces(families: Iterable<string>): Promise<void> {
  const pending: Array<Promise<void>> = [];
  for (const family of new Set(families)) {
    let promise = loading.get(family);
    if (promise === undefined) {
      promise = load(family);
      loading.set(family, promise);
    }
    pending.push(promise);
  }
  return Promise.all(pending).then(() => undefined);
}
