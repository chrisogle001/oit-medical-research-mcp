import { CmsDataService } from "@oit-medical-research/core";

const service = new CmsDataService();
const search = await service.searchDatasets("Medicare provider enrollment", 5);
const dataset = search.results.find((result) =>
  result.title.toLowerCase().includes("provider enrollment")
);
if (!dataset) throw new Error("CMS catalog search did not return a provider enrollment dataset.");

const query = await service.queryDataset(dataset.datasetId, 1, 0);
if (query.returned !== 1 || query.columns.length === 0) {
  throw new Error("CMS dataset query did not return a usable bounded row.");
}

console.log(
  JSON.stringify(
    {
      source: search.source,
      catalogDatasets: search.totalCatalogDatasets,
      matchedDataset: dataset.title,
      datasetId: dataset.datasetId,
      returnedRows: query.returned,
      columns: query.columns
    },
    null,
    2
  )
);
