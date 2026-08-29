import { fetchJson } from "../http.js";
import { normalizeDoi } from "../identifiers.js";
import type {
  CanonicalIdentifier,
  ProviderContext,
  ResearchProvider,
  ResearchRecord
} from "../types.js";

interface OaLocation {
  url?: string;
  url_for_landing_page?: string;
  url_for_pdf?: string;
  license?: string;
  version?: string;
}

interface UnpaywallWork {
  doi?: string;
  doi_url?: string;
  title?: string;
  journal_name?: string;
  published_date?: string;
  year?: number;
  is_oa?: boolean;
  best_oa_location?: OaLocation;
}

export class UnpaywallProvider implements ResearchProvider {
  readonly name = "unpaywall" as const;

  constructor(private readonly context: ProviderContext) {}

  async search(): Promise<ResearchRecord[]> {
    return [];
  }

  async fetch(identifier: CanonicalIdentifier): Promise<ResearchRecord | null> {
    if (identifier.type !== "doi") return null;
    const doi = normalizeDoi(identifier.value);
    const url = new URL(`https://api.unpaywall.org/v2/${encodeURIComponent(doi)}`);
    url.searchParams.set("email", this.context.contactEmail);
    const work = await fetchJson<UnpaywallWork>(this.context.fetch, this.name, url);
    const location = work.best_oa_location;
    return {
      title: work.title ?? `Research article ${doi}`,
      ...(work.journal_name ? { journal: work.journal_name } : {}),
      ...(work.published_date || work.year ? { publicationDate: work.published_date ?? String(work.year) } : {}),
      identifiers: { doi: normalizeDoi(work.doi ?? doi) },
      url: work.doi_url ?? `https://doi.org/${doi}`,
      ...(location?.url ?? location?.url_for_landing_page
        ? { fullTextUrl: location.url ?? location.url_for_landing_page }
        : {}),
      ...(location?.url_for_pdf ? { pdfUrl: location.url_for_pdf } : {}),
      ...(location?.license ? { license: location.license } : {}),
      ...(work.is_oa !== undefined ? { isOpenAccess: work.is_oa } : {}),
      providers: [this.name]
    };
  }
}
