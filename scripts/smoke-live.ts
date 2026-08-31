import { ResearchService } from "@oit-medical-research/core";

const service = new ResearchService({ maxResults: 5 });
const search = await service.search("knee osteoarthritis exercise randomized controlled trial", 5, {
  fromYear: 2022,
  toYear: 2025,
  journals: ["Trials"],
  fullTextOnly: true
});

if (search.results.length === 0) {
  throw new Error("Live search returned no results.");
}
if (
  !search.results.every(
    (result) =>
      result.journal?.toLowerCase() === "trials" &&
      Number(result.publicationDate?.slice(0, 4)) >= 2022 &&
      Number(result.publicationDate?.slice(0, 4)) <= 2025 &&
      result.fullTextAvailable &&
      result.fullTextStatus !== "not-indicated" &&
      typeof result.isPreprint === "boolean" &&
      typeof result.isRetracted === "boolean"
  )
) {
  throw new Error("Live search did not honor the structured journal, date, and full-text filters.");
}
if (
  !search.providerDiagnostics.attempted.includes("pubmed") ||
  !search.providerDiagnostics.attempted.includes("europe-pmc") ||
  search.providerDiagnostics.failed.some(
    (provider) => !search.providerDiagnostics.attempted.includes(provider)
  )
) {
  throw new Error("Live search provider diagnostics were incomplete.");
}

const article = await service.fetch(search.results[0]!.id);
if (
  typeof article.metadata.isPreprint !== "boolean" ||
  typeof article.metadata.isRetracted !== "boolean" ||
  !article.metadata.fullTextStatus ||
  article.providerDiagnostics.attempted.length === 0
) {
  throw new Error("Fetched article status metadata was incomplete.");
}
if (
  !article.metadata.authors?.includes("Shaifuzain Ab Rahman") ||
  !article.metadata.authors.includes("Amran Ahmed Shokri") ||
  article.metadata.authors.includes("Ab Rahman S") ||
  article.metadata.authors.includes("Ahmed Shokri A")
) {
  throw new Error("Fetched article authors were not conservatively reconciled.");
}
const retractedArticle = await service.fetch("pmid:32450107");
if (
  retractedArticle.metadata.isRetracted !== true ||
  !Array.isArray(retractedArticle.metadata.statusWarnings)
) {
  throw new Error("A known retracted publication was not clearly labeled.");
}
const citations = await service.citations("pmid:32678530", "references", 3);
if (citations.total < 3 || citations.results.length !== 3) {
  throw new Error("Live citation lookup returned an incomplete reference network.");
}
const annotations = await service.annotations("pmid:21494379", 3, {
  types: ["Chemicals"],
  sections: ["Title", "Abstract"],
  providers: ["Europe PMC"]
});
if (
  annotations.total < 3 ||
  annotations.annotations.length !== 3 ||
  !annotations.annotations.every(
    (annotation) => annotation.type === "Chemicals" && annotation.tags.length > 0
  )
) {
  throw new Error("Live article annotations were incomplete or incorrectly filtered.");
}
console.log(
  JSON.stringify(
    {
      searchResultCount: search.results.length,
      firstResultId: search.results[0]!.id,
      firstResultJournal: search.results[0]!.journal,
      firstResultPublicationDate: search.results[0]!.publicationDate,
      firstResultProviders: search.results[0]!.providers,
      firstResultFullTextAvailable: search.results[0]!.fullTextAvailable,
      firstResultFullTextStatus: search.results[0]!.fullTextStatus,
      searchProviderDiagnostics: search.providerDiagnostics,
      firstResultIsPreprint: search.results[0]!.isPreprint,
      firstResultIsRetracted: search.results[0]!.isRetracted,
      fetchedId: article.id,
      fetchedTitle: article.title,
      fetchedAuthors: article.metadata.authors,
      textCharacters: article.text.length,
      providers: article.metadata.providers,
      textType: article.metadata.textType,
      fullTextStatus: article.metadata.fullTextStatus,
      fetchProviderDiagnostics: article.providerDiagnostics,
      retractedFixtureId: retractedArticle.id,
      retractedFixtureWarning: retractedArticle.metadata.statusWarnings,
      citationDirection: citations.direction,
      citationTotal: citations.total,
      citationResults: citations.results.map((result) => result.id),
      annotationArticle: annotations.article.id,
      annotationTotal: annotations.total,
      annotationResults: annotations.annotations.map((annotation) => ({
        text: annotation.text,
        section: annotation.section,
        tag: annotation.tags[0]?.name
      }))
    },
    null,
    2
  )
);
