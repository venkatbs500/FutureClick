/**
 * FC-007 Sprint 1 — exact GitHub Settings route authorization.
 */

export const FC007_HOSTNAME = "github.com";
export const FC007_PROTOCOL = "https:";

export interface Fc007AuthorizedRoute {
  readonly ownerDisplay: string;
  readonly ownerNormalized: string;
  readonly repoDisplay: string;
  readonly repoNormalized: string;
  readonly pathnameExact: string;
  readonly pathnameCanonical: string;
  readonly origin: string;
}

export type Fc007LocationResult =
  | { readonly status: "authorized"; readonly route: Fc007AuthorizedRoute }
  | { readonly status: "abstain"; readonly reason: string };

const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const REPO_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?$/;

export function isSupportedOwnerSegment(segment: string): boolean {
  if (segment.length < 1 || segment.length > 39) return false;
  if (segment.includes("%")) return false;
  return OWNER_RE.test(segment);
}

export function isSupportedRepoSegment(segment: string): boolean {
  if (segment.length < 1 || segment.length > 100) return false;
  if (segment.includes("%")) return false;
  if (segment === "." || segment === "..") return false;
  return REPO_RE.test(segment);
}

export function asciiLower(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

export function isTopFrame(win: Window = window): boolean {
  try {
    return win === win.top;
  } catch {
    return false;
  }
}

/**
 * Runtime action authorization. Query/fragment are ignored for identity and
 * never retained. Injection match envelope is NOT authorization.
 */
export function authorizeFc007SettingsLocation(
  loc: Pick<Location, "protocol" | "hostname" | "port" | "pathname">,
  options?: { readonly requireTopFrame?: boolean; readonly win?: Window },
): Fc007LocationResult {
  if (options?.requireTopFrame !== false) {
    const win = options?.win ?? (typeof window !== "undefined" ? window : undefined);
    if (win && !isTopFrame(win)) {
      return { status: "abstain", reason: "NOT_TOP_FRAME" };
    }
  }

  if (loc.protocol !== FC007_PROTOCOL) {
    return { status: "abstain", reason: "UNSUPPORTED_PROTOCOL" };
  }
  if (loc.hostname !== FC007_HOSTNAME) {
    return { status: "abstain", reason: "UNSUPPORTED_HOST" };
  }
  if (loc.port !== "" && loc.port !== "443") {
    return { status: "abstain", reason: "UNSUPPORTED_PORT" };
  }

  const pathnameExact = loc.pathname;
  if (pathnameExact.includes("%")) {
    return { status: "abstain", reason: "PERCENT_ENCODED_PATH" };
  }

  // Strip at most one trailing slash for segment parse; retain exact string.
  const forParse =
    pathnameExact.length > 1 && pathnameExact.endsWith("/")
      ? pathnameExact.slice(0, -1)
      : pathnameExact;

  if (!forParse.startsWith("/")) {
    return { status: "abstain", reason: "INVALID_PATH" };
  }

  const parts = forParse.slice(1).split("/");
  if (parts.length !== 3) {
    return { status: "abstain", reason: "UNSUPPORTED_PATH_SEGMENT_COUNT" };
  }

  const [ownerDisplay, repoDisplay, settingsSeg] = parts;
  if (!ownerDisplay || !repoDisplay || settingsSeg !== "settings") {
    return { status: "abstain", reason: "UNSUPPORTED_PATH" };
  }

  // Disallow extra trailing content already handled by segment count.
  if (pathnameExact !== forParse && pathnameExact !== `${forParse}/`) {
    return { status: "abstain", reason: "UNSUPPORTED_PATH" };
  }

  if (!isSupportedOwnerSegment(ownerDisplay)) {
    return { status: "abstain", reason: "UNSUPPORTED_OWNER_GRAMMAR" };
  }
  if (!isSupportedRepoSegment(repoDisplay)) {
    return { status: "abstain", reason: "UNSUPPORTED_REPO_GRAMMAR" };
  }

  const ownerNormalized = asciiLower(ownerDisplay);
  const repoNormalized = asciiLower(repoDisplay);
  const pathnameCanonical = `/${ownerNormalized}/${repoNormalized}/settings`;

  return {
    status: "authorized",
    route: {
      ownerDisplay,
      ownerNormalized,
      repoDisplay,
      repoNormalized,
      pathnameExact,
      pathnameCanonical,
      origin: `${FC007_PROTOCOL}//${FC007_HOSTNAME}`,
    },
  };
}

export function isSupportedEnglishLocale(lang: string | null | undefined): boolean {
  if (typeof lang !== "string") return false;
  const normalized = lang.trim().toLowerCase();
  if (normalized === "en" || normalized === "en-us") return true;
  // BCP47 primary tag en with optional region/script already covered above for en-us.
  if (normalized.startsWith("en-") && normalized.length <= 12) {
    // Allow en-GB etc? Architecture: observed `en`; "en-US compatibility".
    // Spec: "at minimum support approved observed `en` variant" and en-US.
    // Stick to en and en-us only for V1 conservatism.
    return normalized === "en-us";
  }
  return false;
}
