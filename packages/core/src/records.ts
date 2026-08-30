import { normalizeDoi } from "./identifiers.js";
import type { ResearchRecord } from "./types.js";

export function mergeRecords(records: ResearchRecord[]): ResearchRecord {
  if (records.length === 0) throw new Error("At least one research record is required.");
  const sorted = [...records].sort(scoreRecord).reverse();
  const merged: ResearchRecord = {
    title: firstUseful(sorted.map((record) => record.title)) ?? "Untitled research article",
    identifiers: {
      ...firstIdentifier(sorted, "epmcSource"),
      ...firstIdentifier(sorted, "epmcId"),
      ...firstIdentifier(sorted, "doi"),
      ...firstIdentifier(sorted, "pmid"),
      ...firstIdentifier(sorted, "pmcid")
    },
    providers: unique(sorted.flatMap((record) => record.providers))
  };

  const authors = reconcileAuthors(sorted.flatMap((record) => record.authors ?? []));
  if (authors.length) merged.authors = authors;
  const publicationTypes = uniqueCaseInsensitive(
    sorted.flatMap((record) => record.publicationTypes ?? [])
  );
  if (publicationTypes.length) merged.publicationTypes = publicationTypes;
  if (sorted.some((record) => record.isPreprint === true)) merged.isPreprint = true;
  if (sorted.some((record) => record.isRetracted === true)) merged.isRetracted = true;
  assignString(merged, "abstract", longest(sorted.map((record) => record.abstract)));
  assignString(merged, "fullText", longest(sorted.map((record) => record.fullText)));
  assignString(merged, "journal", firstUseful(sorted.map((record) => record.journal)));
  assignString(merged, "publicationDate", firstUseful(sorted.map((record) => record.publicationDate)));
  assignString(merged, "url", firstUseful(sorted.map((record) => record.url)));
  assignString(merged, "fullTextUrl", firstUseful(sorted.map((record) => record.fullTextUrl)));
  assignString(merged, "pdfUrl", firstUseful(sorted.map((record) => record.pdfUrl)));
  assignString(merged, "license", firstUseful(sorted.map((record) => record.license)));
  if (sorted.some((record) => record.isOpenAccess === true)) merged.isOpenAccess = true;
  const citationCount = sorted.map((record) => record.citationCount).find((value) => value !== undefined);
  if (citationCount !== undefined) merged.citationCount = citationCount;
  return merged;
}

export function deduplicateRecords(records: ResearchRecord[]): ResearchRecord[] {
  const groups: ResearchRecord[][] = [];
  for (const record of records) {
    const matchingGroups = groups.filter((group) => group.some((candidate) => sameArticle(candidate, record)));
    if (matchingGroups.length === 0) {
      groups.push([record]);
      continue;
    }
    const target = matchingGroups[0]!;
    target.push(record);
    for (const duplicate of matchingGroups.slice(1)) {
      target.push(...duplicate);
      groups.splice(groups.indexOf(duplicate), 1);
    }
  }
  return groups.map(mergeRecords);
}

function sameArticle(left: ResearchRecord, right: ResearchRecord): boolean {
  const leftIds = identityValues(left);
  const rightIds = identityValues(right);
  return leftIds.some((id) => rightIds.includes(id));
}

function identityValues(record: ResearchRecord): string[] {
  const values: string[] = [];
  const ids = record.identifiers;
  if (ids.doi) values.push(`doi:${normalizeDoi(ids.doi)}`);
  if (ids.pmid) values.push(`pmid:${ids.pmid}`);
  if (ids.pmcid) values.push(`pmcid:${ids.pmcid.toUpperCase()}`);
  values.push(`title:${record.title.toLowerCase().replace(/\W+/g, " ").trim()}`);
  return values;
}

function scoreRecord(a: ResearchRecord, b: ResearchRecord): number {
  return recordScore(a) - recordScore(b);
}

function recordScore(record: ResearchRecord): number {
  return (
    (record.fullText?.length ?? 0) * 10 +
    (record.abstract?.length ?? 0) +
    (record.identifiers.pmcid ? 500 : 0) +
    (record.identifiers.pmid ? 300 : 0) +
    (record.identifiers.doi ? 200 : 0)
  );
}

function longest(values: Array<string | undefined>): string | undefined {
  return values.filter((value): value is string => Boolean(value)).sort((a, b) => b.length - a.length)[0];
}

function firstUseful<T>(values: Array<T | undefined>): T | undefined {
  return values.find((value): value is T => value !== undefined && value !== "");
}

function firstIdentifier(
  records: ResearchRecord[],
  key: keyof ResearchRecord["identifiers"]
): Partial<ResearchRecord["identifiers"]> {
  const value = firstUseful(records.map((record) => record.identifiers[key]));
  return value === undefined ? {} : { [key]: value };
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

interface ParsedAuthorName {
  family: string;
  given: string[];
  initials: string;
  abbreviated: boolean;
}

interface AuthorCluster {
  display: string;
  parsed: ParsedAuthorName | null;
  index: number;
}

export function reconcileAuthors(values: string[]): string[] {
  const entries = values.flatMap((value, index) => {
    const display = value.replace(/\s+/g, " ").trim();
    return display ? [{ display, parsed: parseAuthorName(display), index }] : [];
  });
  const uniqueEntries = entries.filter(
    (entry, index) =>
      entries.findIndex(
        (candidate) => normalizedAuthorText(candidate.display) === normalizedAuthorText(entry.display)
      ) === index
  );
  const clusters: AuthorCluster[] = [];

  for (const entry of uniqueEntries.filter((candidate) => !candidate.parsed?.abbreviated)) {
    mergeAuthorEntry(clusters, entry);
  }
  for (const entry of uniqueEntries.filter((candidate) => candidate.parsed?.abbreviated)) {
    const expandedMatches = clusters.filter(
      (cluster) =>
        cluster.parsed !== null &&
        cluster.parsed.abbreviated === false &&
        entry.parsed !== null &&
        sameAuthor(cluster.parsed, entry.parsed)
    );
    if (expandedMatches.length === 1) {
      expandedMatches[0]!.index = Math.min(expandedMatches[0]!.index, entry.index);
      continue;
    }
    if (expandedMatches.length > 1) {
      const abbreviatedMatch = clusters.find(
        (cluster) =>
          cluster.parsed?.abbreviated === true &&
          entry.parsed !== null &&
          sameAuthor(cluster.parsed, entry.parsed)
      );
      if (abbreviatedMatch) {
        abbreviatedMatch.index = Math.min(abbreviatedMatch.index, entry.index);
      } else {
        clusters.push({ ...entry });
      }
      continue;
    }
    mergeAuthorEntry(clusters, entry);
  }
  return clusters.sort((left, right) => left.index - right.index).map((cluster) => cluster.display);
}

function mergeAuthorEntry(clusters: AuthorCluster[], entry: AuthorCluster): void {
  const exact = normalizedAuthorText(entry.display);
  const match = clusters.find(
    (cluster) =>
      normalizedAuthorText(cluster.display) === exact ||
      (cluster.parsed !== null &&
        entry.parsed !== null &&
        sameAuthor(cluster.parsed, entry.parsed))
  );
  if (!match) {
    clusters.push({ ...entry });
    return;
  }
  match.index = Math.min(match.index, entry.index);
  if (
    authorDisplayScore(entry.display, entry.parsed) >
    authorDisplayScore(match.display, match.parsed)
  ) {
    match.display = entry.display;
    match.parsed = entry.parsed;
  }
}

function parseAuthorName(value: string): ParsedAuthorName | null {
  if (isCollectiveAuthor(value)) return null;
  const commaParts = value.split(",").map((part) => part.trim()).filter(Boolean);
  let familyText: string;
  let givenTokens: string[];
  if (commaParts.length >= 2) {
    familyText = commaParts[0]!;
    givenTokens = commaParts.slice(1).join(" ").split(/\s+/).filter(Boolean);
  } else {
    const tokens = value.split(/\s+/).filter(Boolean);
    if (tokens.length < 2) return null;
    const finalToken = tokens.at(-1)!;
    if (isInitialToken(finalToken)) {
      familyText = tokens.slice(0, -1).join(" ");
      givenTokens = [finalToken];
    } else {
      familyText = finalToken;
      givenTokens = tokens.slice(0, -1);
    }
  }

  const family = normalizedAuthorText(familyText);
  const given = givenTokens.map(normalizedAuthorText).filter(Boolean);
  if (!family || given.length === 0) return null;
  const initials = given
    .flatMap((token, index) =>
      isInitialToken(givenTokens[index] ?? "") ? token.split("") : token.slice(0, 1)
    )
    .join("");
  if (!initials) return null;
  return {
    family,
    given,
    initials,
    abbreviated: givenTokens.every(isInitialToken)
  };
}

function sameAuthor(left: ParsedAuthorName, right: ParsedAuthorName): boolean {
  if (left.family !== right.family || left.initials !== right.initials) return false;
  if (left.abbreviated || right.abbreviated) return true;
  return left.given[0] === right.given[0];
}

function normalizedAuthorText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isInitialToken(value: string): boolean {
  const compact = value.replace(/[.\-]/g, "");
  return /^[A-Z]{1,4}$/.test(compact);
}

function isCollectiveAuthor(value: string): boolean {
  return /\b(collaboration|committee|consortium|group|institute|network|organization|society|study|team)\b/i.test(
    value
  );
}

function authorDisplayScore(value: string, parsed: ParsedAuthorName | null): number {
  if (!parsed) return normalizedAuthorText(value).length;
  const expandedGivenCharacters = parsed.given.reduce(
    (total, token) => total + (token.length > 1 ? token.length : 0),
    0
  );
  return expandedGivenCharacters * 100 + normalizedAuthorText(value).length - (value.includes(",") ? 1 : 0);
}

function uniqueCaseInsensitive(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function assignString<K extends "abstract" | "fullText" | "journal" | "publicationDate" | "url" | "fullTextUrl" | "pdfUrl" | "license">(
  record: ResearchRecord,
  key: K,
  value: string | undefined
): void {
  if (value !== undefined) record[key] = value;
}
