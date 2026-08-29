import { describe, expect, it } from "vitest";
import { decodeXml, firstTag, xmlToText } from "@oit-medical-research/core";

describe("XML helpers", () => {
  it("extracts nested article text without markup", () => {
    const xml = "<abstract><p>One &amp; <italic>two</italic>.</p><p>Three.</p></abstract>";
    expect(firstTag(xml, "abstract")).toBe("One & two.\nThree.");
  });

  it("decodes numeric entities", () => {
    expect(decodeXml("A&#x2013;B &#8212; C")).toBe("A–B — C");
  });

  it("keeps section boundaries readable", () => {
    expect(xmlToText("<sec><title>Methods</title><p>Details.</p></sec>")).toBe("Methods\nDetails.");
  });
});
