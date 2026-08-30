import { ResearchService } from "@oit-medical-research/core";

const service = new ResearchService({ maxResults: 3 });
const search = await service.search("randomized controlled trial exercise knee osteoarthritis", 3, {
  fromYear: 2020,
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
      Number(result.publicationDate?.slice(0, 4)) >= 2020 &&
      result.fullTextAvailable &&
      typeof result.isPreprint === "boolean" &&
      typeof result.isRetracted === "boolean"
  )
) {
  throw new Error("Live search did not honor the structured journal, date, and full-text filters.");
}

const article = await service.fetch(search.results[0]!.id);
if (
  typeof article.metadata.isPreprint !== "boolean" ||
  typeof article.metadata.isRetracted !== "boolean"
) {
  throw new Error("Fetched article status metadata was incomplete.");
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
      firstResultIsPreprint: search.results[0]!.isPreprint,
      firstResultIsRetracted: search.results[0]!.isRetracted,
      fetchedId: article.id,
      fetchedTitle: article.title,
      textCharacters: article.text.length,
      providers: article.metadata.providers,
      textType: article.metadata.textType,
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
