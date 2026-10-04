/**
 * Deterministic local-only text sanitizer.
 *
 * This module is the SOLE authority deciding what extracted text is safe enough
 * to become semantic vocabulary. Every consumer must run text through here
 * BEFORE fingerprinting, projection, serialization, logging, persistence, or
 * inference. That ordering is the whole point: a fingerprint computed on raw
 * extracted text would be a durable record derived from unsanitized material,
 * and no later redaction could undo it.
 *
 * WHAT THIS IS NOT
 *
 * This is not perfect PII or secret detection, and it must never be described as
 * such. It is a conservative deterministic filter: it recognizes a bounded set of
 * well-known shapes, and it prefers dropping legitimate words over admitting a
 * suspicious one. Residual risk remains and is reduced further by the caller's
 * own caps and by the closed token grammar downstream.
 *
 * It uses no model, no LLM, no heuristic trained on data, and no network. Given
 * identical input it produces identical output, which is what makes the dataset
 * manifests reproducible.
 *
 * REPORTING DISCIPLINE
 *
 * No function here ever returns, logs, or throws a rejected value. Reports carry
 * counts and closed categorical reasons only. A sanitizer that explained itself
 * by quoting the secret it found would defeat its own purpose.
 */

/** Sanitizer contract version. Participates in observation provenance. */
export const TEXT_SANITIZER_VERSION = "1.0";

/**
 * Maximum characters in one separator-delimited segment of a retained token.
 *
 * Deliberately an independent constant rather than an import: this package must
 * not depend on the FC-008 observation package, which depends on this one. A
 * cross-package test asserts the two bounds agree, so the duplication is checked
 * rather than assumed.
 */
export const MAX_SANITIZED_SEGMENT_CHARS = 24;

/** Maximum characters in one whole retained token, across separators. */
export const MAX_SANITIZED_TOKEN_CHARS = 64;

/** Shortest token length at which opaque-identifier screening applies. */
export const MIN_OPAQUE_SCREEN_CHARS = 12;

/**
 * Why material was redacted or dropped. Closed set: a caller cannot invent a new
 * reason, and a report cannot carry free text that might embed a secret.
 */
export const SANITIZER_REDACTION_REASONS = Object.freeze([
  "email-address",
  "url-like",
  "filesystem-path",
  "uuid-like",
  "hash-like",
  "authorization-bearer",
  "api-key-like",
  "high-entropy-opaque",
  "long-digit-sequence",
  "credential-keyword",
  "name-like-field",
  "user-entered-content",
  "hidden-field-value",
  "password-field",
  "over-length-segment",
  "empty-after-normalization",
] as const);
export type SanitizerRedactionReason = (typeof SANITIZER_REDACTION_REASONS)[number];

/**
 * How the extractor classified the ORIGIN of a string.
 *
 * The extractor does not decide what is safe; it declares what kind of slot the
 * text came from, and the sanitizer decides. Everything other than `semantic` is
 * dropped in full, because a private name, a value the user typed, a hidden form
 * value, and a password are never semantic vocabulary regardless of content.
 */
export const TEXT_DISPOSITIONS = Object.freeze([
  "semantic",
  "name-like",
  "user-entered",
  "hidden-value",
  "password",
] as const);
export type TextDisposition = (typeof TEXT_DISPOSITIONS)[number];

/** Dispositions dropped wholesale, with the reason each maps to. */
const NON_SEMANTIC_DISPOSITIONS: ReadonlyMap<TextDisposition, SanitizerRedactionReason> = new Map<
  TextDisposition,
  SanitizerRedactionReason
>([
  ["name-like", "name-like-field"],
  ["user-entered", "user-entered-content"],
  ["hidden-value", "hidden-field-value"],
  ["password", "password-field"],
]);

export interface SanitizerFieldInput {
  readonly text: string;
  readonly disposition: TextDisposition;
}

export interface SanitizedField {
  /** Retained normalized tokens, in first-appearance order, deduplicated. */
  readonly tokens: readonly string[];
  /** Candidate tokens seen before screening. */
  readonly inputTokenCount: number;
  /** Tokens retained. Always equals `tokens.length`. */
  readonly retainedTokenCount: number;
  /** Candidate tokens removed by screening. */
  readonly redactedTokenCount: number;
  /** Whether the entire field was discarded without tokenization. */
  readonly fieldDropped: boolean;
  /** Whether the raw string exceeded the caller's byte cap and was truncated. */
  readonly truncated: boolean;
  /** Distinct reasons observed, in canonical order. Never contains a value. */
  readonly reasons: readonly SanitizerRedactionReason[];
}

export interface SanitizerReport {
  readonly sanitizerVersion: string;
  readonly inputFieldCount: number;
  readonly droppedFieldCount: number;
  readonly inputTokenCount: number;
  readonly retainedTokenCount: number;
  readonly redactedTokenCount: number;
  readonly truncatedStringCount: number;
  /** Retained share of candidate tokens, in [0, 1]. 1 when nothing was seen. */
  readonly retainedRatio: number;
  /** Removed share of candidate tokens, in [0, 1]. */
  readonly redactionRatio: number;
  /** Whether any credential-shaped material was recognized. */
  readonly credentialPatternDetected: boolean;
  /** Count of fields dropped specifically for being name-like. */
  readonly nameLikeDroppedCount: number;
  readonly reasons: readonly SanitizerRedactionReason[];
}

export interface SanitizerResult {
  readonly fields: readonly SanitizedField[];
  readonly report: SanitizerReport;
}

// ============================================================================
// RAW-STRING DETECTORS
// ============================================================================
//
// These run on the ORIGINAL string, before tokenization. Order matters: an email
// address split into tokens is no longer recognizable as one, so shape-based
// detection has to happen while the shape still exists.

/** Reasons that indicate credential-shaped material rather than mere identity. */
const CREDENTIAL_REASONS: ReadonlySet<SanitizerRedactionReason> = new Set<SanitizerRedactionReason>(
  [
    "authorization-bearer",
    "api-key-like",
    "password-field",
    "credential-keyword",
    "high-entropy-opaque",
  ],
);

interface RawDetector {
  readonly reason: SanitizerRedactionReason;
  readonly pattern: RegExp;
}

/**
 * Whole-field detectors. A match drops the ENTIRE field rather than excising the
 * match, because a string containing a secret has already demonstrated that it
 * carries material the extractor misjudged as semantic, and the remainder is not
 * worth the risk.
 */
const RAW_FIELD_DETECTORS: readonly RawDetector[] = Object.freeze([
  // local@domain.tld
  { reason: "email-address", pattern: /[^\s@]+@[^\s@]+\.[^\s@]{2,}/ },
  // scheme://host, protocol-relative //host, and bare www.host
  { reason: "url-like", pattern: /\b[a-z][a-z0-9+.-]*:\/\/\S+|(^|\s)\/\/\S+|\bwww\.[^\s/]+\.\S+/i },
  // mailto:, tel:, data:, javascript: and similar opaque schemes
  { reason: "url-like", pattern: /\b(?:mailto|tel|data|javascript|file|blob|chrome|about):/i },
  // POSIX absolute/relative paths with at least two segments, Windows drive paths,
  // UNC paths, and home-relative paths.
  { reason: "filesystem-path", pattern: /(?:^|\s)(?:\.{0,2}\/)[\w.-]+\/[\w.-]+/ },
  // Bare relative paths need care: "private/public" and "read/write" are genuine
  // UI phrasing in this domain, so a two-segment slash alone is NOT treated as a
  // path. Three or more segments, or a trailing file extension, are.
  { reason: "filesystem-path", pattern: /(?:^|\s)[\w.-]+\/[\w.-]+\/[\w.-]+/ },
  { reason: "filesystem-path", pattern: /(?:^|\s)[\w-]+\/[\w-]+\.[a-z0-9]{1,8}\b/i },
  // A bare filename names a private object even without a directory component.
  {
    reason: "filesystem-path",
    pattern:
      /\b[\w-]+\.(?:txt|pdf|docx?|xlsx?|pptx?|csv|json|ya?ml|xml|html?|md|png|jpe?g|gif|svg|zip|tar|gz|sql|db|env|pem|key|log|bak)\b/i,
  },
  { reason: "filesystem-path", pattern: /\b[A-Za-z]:[\\/][\w.\\/-]+/ },
  { reason: "filesystem-path", pattern: /(?:^|\s)\\\\[\w.-]+\\/ },
  { reason: "filesystem-path", pattern: /(?:^|\s)~\/[\w.-]+/ },
  // Authorization headers and bearer/basic credentials.
  { reason: "authorization-bearer", pattern: /\b(?:bearer|basic|digest)\s+[\w\-._~+/=]{8,}/i },
  { reason: "authorization-bearer", pattern: /\bauthorization\s*[:=]/i },
  // JWT: three base64url segments separated by dots.
  {
    reason: "authorization-bearer",
    pattern: /\beyJ[\w-]{4,}\.[\w-]{4,}\.[\w-]{4,}/,
  },
  // Well-known vendor key prefixes, kept generic rather than exhaustive.
  { reason: "api-key-like", pattern: /\b(?:sk|pk|rk|ak)[-_](?:live|test|prod)?[-_]?[\w-]{12,}/i },
  { reason: "api-key-like", pattern: /\bgh[pousr]_[A-Za-z0-9]{16,}/ },
  { reason: "api-key-like", pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
  { reason: "api-key-like", pattern: /\bAKIA[0-9A-Z]{12,}/ },
  { reason: "api-key-like", pattern: /\bAIza[\w-]{20,}/ },
  { reason: "api-key-like", pattern: /-{3,}BEGIN[A-Z ]*(?:PRIVATE KEY|CERTIFICATE)/i },
  // key=value / key: value where the key names a credential concept.
  {
    reason: "credential-keyword",
    pattern:
      /\b(?:pass(?:word|wd|phrase)?|secret|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|refresh[_-]?token|session[_-]?id|otp|mfa[_-]?code|cvv|ssn|credit[_-]?card)\b\s*[:=]/i,
  },
  // Bare credential nouns with an adjacent opaque run, e.g. "token abc123def456".
  {
    reason: "credential-keyword",
    pattern: /\b(?:token|secret|password|passphrase|credential)\b\s+\S{10,}/i,
  },
  // Separator-bearing identifiers MUST be matched here rather than at token level.
  // Normalization splits on separators, so a UUID would otherwise arrive as five
  // short hex fragments, none of which is individually recognizable, and would be
  // retained as vocabulary. Shape detection has to precede the step that destroys
  // the shape.
  {
    reason: "uuid-like",
    pattern: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i,
  },
  // Hex groups joined by separators, totalling enough to behave as identity.
  { reason: "hash-like", pattern: /\b[0-9a-f]{4,}(?:[-_][0-9a-f]{4,}){2,}\b/i },
  // Base32 is screened here too, because token screening sees only lowercase.
  { reason: "hash-like", pattern: /\b[A-Z2-7]{16,}={0,6}\b/ },
]);

// ============================================================================
// TOKEN-LEVEL DETECTORS
// ============================================================================

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_RUN_PATTERN = /^[0-9a-f]{16,}$/i;
const DIGIT_RUN_PATTERN = /^[0-9]{7,}$/;
const BASE32_RUN_PATTERN = /^[A-Z2-7]{16,}=*$/;

/**
 * Shannon entropy per character, in bits.
 *
 * Used only as one signal among several. Entropy alone would flag legitimate long
 * words, so the caller also requires mixed character classes and a length floor.
 */
export function shannonEntropyPerChar(value: string): number {
  if (value.length === 0) {
    return 0;
  }
  const counts = new Map<string, number>();
  for (const char of value) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Entropy threshold in bits per character for opaque-identifier screening. */
export const OPAQUE_ENTROPY_THRESHOLD = 3;

/**
 * Whether a token looks like an opaque identifier rather than a word.
 *
 * Requires length, high entropy, AND a digit-letter mix. English UI words are
 * long but low entropy and letter-only, so they survive; random identifiers fail
 * on all three counts.
 */
function isHighEntropyOpaque(token: string): boolean {
  if (token.length < MIN_OPAQUE_SCREEN_CHARS) {
    return false;
  }
  const hasDigit = /[0-9]/.test(token);
  const hasLetter = /[a-z]/i.test(token);
  if (!hasDigit || !hasLetter) {
    return false;
  }
  return shannonEntropyPerChar(token) >= OPAQUE_ENTROPY_THRESHOLD;
}

/** First screening reason that rejects this token, or null to retain it. */
function screenToken(token: string): SanitizerRedactionReason | null {
  if (UUID_PATTERN.test(token)) {
    return "uuid-like";
  }
  if (HEX_RUN_PATTERN.test(token) || BASE32_RUN_PATTERN.test(token)) {
    return "hash-like";
  }
  if (DIGIT_RUN_PATTERN.test(token)) {
    return "long-digit-sequence";
  }
  if (isHighEntropyOpaque(token)) {
    return "high-entropy-opaque";
  }
  if (token.length > MAX_SANITIZED_TOKEN_CHARS) {
    return "over-length-segment";
  }
  for (const segment of token.split(/[-_]/)) {
    if (segment.length > MAX_SANITIZED_SEGMENT_CHARS) {
      return "over-length-segment";
    }
  }
  return null;
}

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * Reduces a raw string to candidate normalized tokens.
 *
 * Unicode is folded to NFKD and combining marks are removed so that visually
 * identical labels normalize identically; anything still outside `[a-z0-9]`
 * becomes a separator. The result satisfies the downstream closed token grammar
 * by construction rather than by later validation.
 */
export function normalizeToTokens(text: string): readonly string[] {
  const folded = text.normalize("NFKD").replace(/\p{M}+/gu, "");
  const lowered = folded.toLowerCase();
  const separated = lowered.replace(/[^a-z0-9]+/g, " ");
  return separated.split(" ").filter((part) => part.length > 0);
}

/** UTF-8 byte cost of one code point. */
function utf8CostOfCodePoint(codePoint: number): number {
  if (codePoint < 0x80) {
    return 1;
  }
  if (codePoint < 0x800) {
    return 2;
  }
  if (codePoint < 0x10000) {
    return 3;
  }
  return 4;
}

/** UTF-8 byte length, computed without a platform encoder. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    bytes += utf8CostOfCodePoint(char.codePointAt(0) ?? 0);
  }
  return bytes;
}

/**
 * Truncates to a UTF-8 byte budget without splitting a code point.
 *
 * Bytes, not characters, because the documented cap is a byte cap and a
 * character-based truncation could still exceed it for non-ASCII text.
 *
 * Byte costs are computed directly rather than through `TextEncoder`, which is
 * absent from `lib: ES2022` and would drag a platform global into a package that
 * deliberately has none. Iterating code points also means a surrogate pair can
 * never be split, so no replacement character is ever produced.
 */
export function truncateUtf8(text: string, maxBytes: number): { text: string; truncated: boolean } {
  let bytes = 0;
  let endIndex = 0;
  for (const char of text) {
    const cost = utf8CostOfCodePoint(char.codePointAt(0) ?? 0);
    if (bytes + cost > maxBytes) {
      return { text: text.slice(0, endIndex), truncated: true };
    }
    bytes += cost;
    endIndex += char.length;
  }
  return { text, truncated: false };
}

// ============================================================================
// FIELD SANITIZATION
// ============================================================================

export interface SanitizeFieldOptions {
  /** UTF-8 byte cap applied before any other processing. */
  readonly maxStringUtf8Bytes: number;
  /** Maximum tokens retained from one field. */
  readonly maxTokens: number;
}

function orderReasons(found: ReadonlySet<SanitizerRedactionReason>): readonly string[] {
  return SANITIZER_REDACTION_REASONS.filter((reason) => found.has(reason));
}

/**
 * Sanitizes one extracted string.
 *
 * Order within the field: byte truncation, disposition check, whole-field secret
 * shapes, normalization, per-token screening, dedup, cap. Secret shapes are
 * tested before normalization because normalization destroys the shapes.
 */
export function sanitizeTextField(
  input: SanitizerFieldInput,
  options: SanitizeFieldOptions,
): SanitizedField {
  const reasons = new Set<SanitizerRedactionReason>();
  const { text: bounded, truncated } = truncateUtf8(input.text, options.maxStringUtf8Bytes);

  const dispositionReason = NON_SEMANTIC_DISPOSITIONS.get(input.disposition);
  if (dispositionReason !== undefined) {
    reasons.add(dispositionReason);
    return {
      tokens: [],
      inputTokenCount: 0,
      retainedTokenCount: 0,
      redactedTokenCount: 0,
      fieldDropped: true,
      truncated,
      reasons: orderReasons(reasons) as readonly SanitizerRedactionReason[],
    };
  }

  for (const detector of RAW_FIELD_DETECTORS) {
    if (detector.pattern.test(bounded)) {
      reasons.add(detector.reason);
    }
  }
  if (reasons.size > 0) {
    return {
      tokens: [],
      inputTokenCount: 0,
      retainedTokenCount: 0,
      redactedTokenCount: 0,
      fieldDropped: true,
      truncated,
      reasons: orderReasons(reasons) as readonly SanitizerRedactionReason[],
    };
  }

  const candidates = normalizeToTokens(bounded);
  if (candidates.length === 0) {
    const emptyReasons =
      bounded.trim().length > 0
        ? (orderReasons(
            new Set<SanitizerRedactionReason>(["empty-after-normalization"]),
          ) as readonly SanitizerRedactionReason[])
        : [];
    return {
      tokens: [],
      inputTokenCount: 0,
      retainedTokenCount: 0,
      redactedTokenCount: 0,
      fieldDropped: false,
      truncated,
      reasons: emptyReasons,
    };
  }

  const retained: string[] = [];
  const seen = new Set<string>();
  let redactedTokenCount = 0;
  for (const candidate of candidates) {
    const rejection = screenToken(candidate);
    if (rejection !== null) {
      reasons.add(rejection);
      redactedTokenCount += 1;
      continue;
    }
    if (seen.has(candidate)) {
      continue;
    }
    if (retained.length >= options.maxTokens) {
      break;
    }
    seen.add(candidate);
    retained.push(candidate);
  }

  return {
    tokens: Object.freeze(retained),
    inputTokenCount: candidates.length,
    retainedTokenCount: retained.length,
    redactedTokenCount,
    fieldDropped: false,
    truncated,
    reasons: orderReasons(reasons) as readonly SanitizerRedactionReason[],
  };
}

/**
 * Sanitizes a set of fields and produces the aggregate report.
 *
 * The report is bounded deterministic metadata: counts, ratios, and closed
 * categorical reasons. It contains no rejected value, so it is safe to log, to
 * embed in a benchmark record, and to serialize.
 */
export function sanitizeFields(
  inputs: readonly SanitizerFieldInput[],
  options: SanitizeFieldOptions,
): SanitizerResult {
  const fields = inputs.map((input) => sanitizeTextField(input, options));
  const reasons = new Set<SanitizerRedactionReason>();
  let inputTokenCount = 0;
  let retainedTokenCount = 0;
  let redactedTokenCount = 0;
  let droppedFieldCount = 0;
  let truncatedStringCount = 0;
  let nameLikeDroppedCount = 0;

  for (const field of fields) {
    inputTokenCount += field.inputTokenCount;
    retainedTokenCount += field.retainedTokenCount;
    redactedTokenCount += field.redactedTokenCount;
    if (field.fieldDropped) {
      droppedFieldCount += 1;
    }
    if (field.truncated) {
      truncatedStringCount += 1;
    }
    for (const reason of field.reasons) {
      reasons.add(reason);
      if (reason === "name-like-field") {
        nameLikeDroppedCount += 1;
      }
    }
  }

  // Denominator counts only tokenized candidates. A wholly dropped field
  // contributes no candidates, so its loss is reported through
  // `droppedFieldCount` rather than being smuggled into the ratio.
  const retainedRatio = inputTokenCount === 0 ? 1 : retainedTokenCount / inputTokenCount;
  let credentialPatternDetected = false;
  for (const reason of reasons) {
    if (CREDENTIAL_REASONS.has(reason)) {
      credentialPatternDetected = true;
      break;
    }
  }

  return {
    fields: Object.freeze(fields),
    report: Object.freeze({
      sanitizerVersion: TEXT_SANITIZER_VERSION,
      inputFieldCount: inputs.length,
      droppedFieldCount,
      inputTokenCount,
      retainedTokenCount,
      redactedTokenCount,
      truncatedStringCount,
      retainedRatio,
      redactionRatio: 1 - retainedRatio,
      credentialPatternDetected,
      nameLikeDroppedCount,
      reasons: Object.freeze(
        orderReasons(reasons) as readonly SanitizerRedactionReason[],
      ) as readonly SanitizerRedactionReason[],
    }),
  };
}
