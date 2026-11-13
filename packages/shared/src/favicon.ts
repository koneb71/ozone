function faviconUrlForPage(rawUrl: string | null | undefined, _size = 32): string | null {
  if (!rawUrl || rawUrl.length > 4096) return null;
  try {
    const pageUrl = new URL(rawUrl);
    if (pageUrl.protocol !== "http:" && pageUrl.protocol !== "https:") return null;
    return new URL("/favicon.ico", pageUrl.origin).href;
  } catch {
    return null;
  }
}

/** Accepts image URLs supplied by a trusted provider event. */
function explicitFaviconUrl(rawUrl: string | null | undefined): string | null {
  if (!rawUrl || rawUrl.length > 4096) return null;
  try {
    const url = new URL(rawUrl);
    return url.protocol === "http:" || url.protocol === "https:" || url.protocol === "data:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function toolActivityFaviconUrl(
  icon: {
    readonly pageUrl: string;
    readonly faviconUrl?: string | undefined;
    readonly faviconUrlDark?: string | undefined;
  },
  appearance: "light" | "dark",
  size = 32,
): string | null {
  if (appearance === "dark") {
    return (
      explicitFaviconUrl(icon.faviconUrlDark) ??
      explicitFaviconUrl(icon.faviconUrl) ??
      faviconUrlForPage(icon.pageUrl, size)
    );
  }
  return explicitFaviconUrl(icon.faviconUrl) ?? faviconUrlForPage(icon.pageUrl, size);
}
