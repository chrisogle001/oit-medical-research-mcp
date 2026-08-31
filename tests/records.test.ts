import { describe, expect, it } from "vitest";
import { mergeRecords, reconcileAuthors } from "@oit-medical-research/core";

describe("record reconciliation", () => {
  it("merges abbreviated and expanded forms of the same author", () => {
    expect(
      reconcileAuthors([
        "Spencer R",
        "Rebecca Spencer",
        "Smith AB",
        "Alice B Smith",
        "García, María",
        "Maria Garcia"
      ])
    ).toEqual(["Rebecca Spencer", "Alice B Smith", "Maria Garcia"]);
  });

  it("merges abbreviated multi-word family names with expanded names", () => {
    expect(
      reconcileAuthors([
        "Ab Rahman S",
        "Ahmed Shokri A",
        "Shaifuzain Ab Rahman",
        "Amran Ahmed Shokri"
      ])
    ).toEqual(["Shaifuzain Ab Rahman", "Amran Ahmed Shokri"]);
  });

  it("keeps a multi-word family abbreviation separate when expanded matches are ambiguous", () => {
    expect(reconcileAuthors(["Ab Rahman S", "Salma Ab Rahman", "Sofia Ab Rahman"])).toEqual([
      "Ab Rahman S",
      "Salma Ab Rahman",
      "Sofia Ab Rahman"
    ]);
  });

  it("does not merge distinct authors who only share a surname or collective label", () => {
    expect(
      reconcileAuthors([
        "John A Smith",
        "Jane A Smith",
        "World Health Organization",
        "World Heart Organization"
      ])
    ).toEqual([
      "John A Smith",
      "Jane A Smith",
      "World Health Organization",
      "World Heart Organization"
    ]);
  });

  it("keeps an abbreviated name separate when it could refer to multiple people", () => {
    expect(reconcileAuthors(["Smith J", "John Smith", "Jane Smith"])).toEqual([
      "Smith J",
      "John Smith",
      "Jane Smith"
    ]);
  });

  it("uses reconciled authors when merging provider records", () => {
    const merged = mergeRecords([
      {
        title: "Sleep and cognition",
        authors: ["Spencer R", "Smith AB"],
        identifiers: { pmid: "1" },
        providers: ["pubmed"]
      },
      {
        title: "Sleep and cognition",
        authors: ["Rebecca Spencer", "Alice B Smith"],
        identifiers: { doi: "10.1000/sleep" },
        providers: ["crossref"]
      }
    ]);

    expect(merged.authors).toEqual(["Rebecca Spencer", "Alice B Smith"]);
  });
});
