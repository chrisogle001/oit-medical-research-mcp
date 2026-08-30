import { describe, expect, it, vi } from "vitest";
import { CrossrefProvider } from "../packages/core/src/providers/crossref.js";
import { PubMedProvider } from "../packages/core/src/providers/pubmed.js";
import type { FetchLike } from "../packages/core/src/types.js";

describe("provider publication status metadata", () => {
  it("reads PubMed publication types and retraction relationships", async () => {
    const fetcher = vi.fn<FetchLike>(async () =>
      new Response(`
        <PubmedArticleSet>
          <PubmedArticle>
            <MedlineCitation>
              <Article>
                <ArticleTitle>Registry analysis of antiviral treatment</ArticleTitle>
                <PublicationTypeList>
                  <PublicationType>Journal Article</PublicationType>
                  <PublicationType>Retracted Publication</PublicationType>
                </PublicationTypeList>
              </Article>
              <CommentsCorrectionsList>
                <CommentsCorrections RefType="RetractionIn" />
              </CommentsCorrectionsList>
            </MedlineCitation>
            <PubmedData>
              <ArticleIdList><ArticleId IdType="pubmed">32450107</ArticleId></ArticleIdList>
            </PubmedData>
          </PubmedArticle>
        </PubmedArticleSet>
      `)
    );
    const provider = new PubMedProvider({
      fetch: fetcher,
      contactEmail: "research-api@example.test"
    });

    const record = await provider.fetch({ type: "pmid", value: "32450107" });

    expect(record).toMatchObject({
      publicationTypes: ["Journal Article", "Retracted Publication"],
      isRetracted: true
    });
    expect(record?.isPreprint).toBeUndefined();
  });

  it("uses Crossref update links without mistaking a retraction notice for the retracted work", async () => {
    const payloads = [
      {
        message: {
          DOI: "10.1016/S0140-6736(20)31180-6",
          title: ["A registry analysis"],
          type: "journal-article",
          "updated-by": [{ type: "retraction" }]
        }
      },
      {
        message: {
          DOI: "10.1016/S0140-6736(20)31324-6",
          title: ["Retraction notice"],
          type: "journal-article",
          "update-to": [{ type: "retraction" }]
        }
      }
    ];
    const fetcher = vi.fn<FetchLike>(async () => Response.json(payloads.shift()));
    const provider = new CrossrefProvider({
      fetch: fetcher,
      contactEmail: "research-api@example.test"
    });

    const original = await provider.fetch({
      type: "doi",
      value: "10.1016/S0140-6736(20)31180-6"
    });
    const notice = await provider.fetch({
      type: "doi",
      value: "10.1016/S0140-6736(20)31324-6"
    });

    expect(original).toMatchObject({
      publicationTypes: ["Journal Article"],
      isRetracted: true
    });
    expect(notice?.isRetracted).toBeUndefined();
  });

  it("detects a Crossref preprint relationship without classifying all posted content as preprints", async () => {
    const payloads = [
      {
        message: {
          DOI: "10.1101/2020.04.10.20060558",
          title: ["Early findings"],
          type: "posted-content",
          relation: { "is-preprint-of": [{ id: "10.1000/published" }] }
        }
      },
      {
        message: {
          DOI: "10.1000/report",
          title: ["A posted report"],
          type: "posted-content"
        }
      }
    ];
    const fetcher = vi.fn<FetchLike>(async () => Response.json(payloads.shift()));
    const provider = new CrossrefProvider({
      fetch: fetcher,
      contactEmail: "research-api@example.test"
    });

    const preprint = await provider.fetch({ type: "doi", value: "10.1101/2020.04.10.20060558" });
    const postedReport = await provider.fetch({ type: "doi", value: "10.1000/report" });

    expect(preprint).toMatchObject({ publicationTypes: ["Posted Content"], isPreprint: true });
    expect(postedReport?.isPreprint).toBeUndefined();
  });
});
