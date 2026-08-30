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
      result.fullTextAvailable
  )
) {
  throw new Error("Live search did not honor the structured journal, date, and full-text filters.");
}

const article = await service.fetch(search.results[0]!.id);
console.log(
  JSON.stringify(
    {
      searchResultCount: search.results.length,
      firstResultId: search.results[0]!.id,
      firstResultJournal: search.results[0]!.journal,
      firstResultPublicationDate: search.results[0]!.publicationDate,
      firstResultProviders: search.results[0]!.providers,
      firstResultFullTextAvailable: search.results[0]!.fullTextAvailable,
      fetchedId: article.id,
      fetchedTitle: article.title,
      textCharacters: article.text.length,
      providers: article.metadata.providers,
      textType: article.metadata.textType
    },
    null,
    2
  )
);
