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

  const authors = unique(sorted.flatMap((record) => record.authors ?? []));
  if (authors.length) merged.authors = authors;
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

function assignString<K extends "abstract" | "fullText" | "journal" | "publicationDate" | "url" | "fullTextUrl" | "pdfUrl" | "license">(
  record: ResearchRecord,
  key: K,
  value: string | undefined
): void {
  if (value !== undefined) record[key] = value;
}
