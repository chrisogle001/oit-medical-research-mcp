import type { ResearchRecord } from "./types.js";

export const PREPRINT_WARNING = "Preprint: this work may not have completed peer review.";
export const RETRACTION_WARNING =
  "Retracted publication: do not treat this record as active evidence.";

export function normalizePublicationTypes(
  values: Array<string | undefined>
): string[] {
  const types: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const normalized = value?.replace(/\s+/g, " ").trim();
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    types.push(normalized);
  }
  return types;
}

export function hasPublicationType(types: string[], expected: string): boolean {
  const normalizedExpected = expected.toLowerCase();
  return types.some((type) => type.toLowerCase() === normalizedExpected);
}

export function humanizePublicationType(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1).toLowerCase()}`)
    .join(" ");
}

export function titleIndicatesRetraction(title: string | undefined): boolean {
  return /^\s*(?:retracted|withdrawn)(?:\s*:|\b)/i.test(title ?? "");
}

export function researchStatusWarnings(record: ResearchRecord): string[] {
  return [
    record.isPreprint ? PREPRINT_WARNING : undefined,
    record.isRetracted ? RETRACTION_WARNING : undefined
  ].filter((warning): warning is string => Boolean(warning));
}
