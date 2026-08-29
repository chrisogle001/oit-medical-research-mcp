import { ResearchService } from "@oit-medical-research/core";

const service = new ResearchService({ maxResults: 3 });
const search = await service.search("semaglutide cardiovascular outcomes trial");

if (search.results.length === 0) {
  throw new Error("Live search returned no results.");
}

const article = await service.fetch(search.results[0]!.id);
console.log(
  JSON.stringify(
    {
      searchResultCount: search.results.length,
      firstResultId: search.results[0]!.id,
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
