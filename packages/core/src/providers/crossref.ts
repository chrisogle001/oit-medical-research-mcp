import { fetchJson } from "../http.js";
import { normalizeDoi } from "../identifiers.js";
import { xmlToText } from "../xml.js";
import type {
  CanonicalIdentifier,
  ProviderContext,
  ResearchProvider,
  ResearchRecord
} from "../types.js";

interface CrossrefWork {
  DOI?: string;
  URL?: string;
  title?: string[];
  abstract?: string;
  author?: Array<{ given?: string; family?: string; name?: string }>;
  "container-title"?: string[];
  published?: { "date-parts"?: number[][] };
  "published-print"?: { "date-parts"?: number[][] };
  "published-online"?: { "date-parts"?: number[][] };
  license?: Array<{ URL?: string }>;
  "is-referenced-by-count"?: number;
}

interface CrossrefSearchPayload {
  message?: { items?: CrossrefWork[] };
}

interface CrossrefWorkPayload {
  message?: CrossrefWork;
}

export class CrossrefProvider implements ResearchProvider {
  readonly name = "crossref" as const;

  constructor(private readonly context: ProviderContext) {}

  async search(query: string, limit: number): Promise<ResearchRecord[]> {
    const url = new URL("https://api.crossref.org/works");
    url.searchParams.set("query", query);
    url.searchParams.set("rows", String(limit));
    url.searchParams.set("select", "DOI,URL,title,abstract,author,container-title,published,published-print,published-online,license,is-referenced-by-count");
    url.searchParams.set("mailto", this.context.contactEmail);
    const payload = await fetchJson<CrossrefSearchPayload>(this.context.fetch, this.name, url);
    return (payload.message?.items ?? []).map((work) => this.toRecord(work));
  }

  async fetch(identifier: CanonicalIdentifier): Promise<ResearchRecord | null> {
    if (identifier.type !== "doi") return null;
    const doi = normalizeDoi(identifier.value);
    const url = new URL(`https://api.crossref.org/works/${encodeURIComponent(doi)}`);
    url.searchParams.set("mailto", this.context.contactEmail);
    const payload = await fetchJson<CrossrefWorkPayload>(this.context.fetch, this.name, url);
    return payload.message ? this.toRecord(payload.message) : null;
  }

  private toRecord(work: CrossrefWork): ResearchRecord {
    const doi = work.DOI ? normalizeDoi(work.DOI) : undefined;
    const authors = (work.author ?? [])
      .map((author) => author.name ?? [author.given, author.family].filter(Boolean).join(" "))
      .filter(Boolean);
    const date = work.published ?? work["published-online"] ?? work["published-print"];
    const dateParts = date?.["date-parts"]?.[0];
    const publicationDate = dateParts?.filter((part) => part !== undefined).join("-");

    return {
      title: xmlToText(work.title?.[0] ?? "Untitled Crossref work"),
      ...(authors.length ? { authors } : {}),
      ...(work.abstract ? { abstract: xmlToText(work.abstract) } : {}),
      ...(work["container-title"]?.[0] ? { journal: work["container-title"][0] } : {}),
      ...(publicationDate ? { publicationDate } : {}),
      identifiers: doi ? { doi } : {},
      ...(work.URL || doi ? { url: work.URL ?? `https://doi.org/${doi}` } : {}),
      ...(work.license?.[0]?.URL ? { license: work.license[0].URL } : {}),
      ...(work["is-referenced-by-count"] !== undefined
        ? { citationCount: work["is-referenced-by-count"] }
        : {}),
      providers: [this.name]
    };
  }
}
