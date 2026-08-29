const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  apos: "'",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\""
};

export function decodeXml(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16))
    )
    .replace(/&#(\d+);/g, (_, decimal: string) =>
      String.fromCodePoint(Number.parseInt(decimal, 10))
    )
    .replace(/&([a-z]+);/gi, (entity, name: string) => ENTITY_MAP[name.toLowerCase()] ?? entity);
}

export function xmlToText(value: string): string {
  return normalizeWhitespace(
    decodeXml(
      value
        .replace(/<\/?(?:p|sec|title|abstract|abstracttext|list-item|boxed-text|caption|statement)[^>]*>/gi, "\n")
        .replace(/<break\s*\/?>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

export function firstTag(xml: string, tag: string): string | undefined {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match?.[1] ? xmlToText(match[1]) : undefined;
}

export function allTags(xml: string, tag: string): string[] {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...xml.matchAll(expression)]
    .map((match) => xmlToText(match[1] ?? ""))
    .filter(Boolean);
}

export function tagBlock(xml: string, tag: string): string | undefined {
  return new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml)?.[1];
}

export function tagBlocks(xml: string, tag: string): string[] {
  const expression = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "gi");
  return [...xml.matchAll(expression)].map((match) => match[1] ?? "");
}

export function attributeTagValue(
  xml: string,
  tag: string,
  attribute: string,
  attributeValue: string
): string | undefined {
  const escapedValue = attributeValue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const expression = new RegExp(
    `<${tag}[^>]*${attribute}=["']${escapedValue}["'][^>]*>([\\s\\S]*?)<\\/${tag}>`,
    "i"
  );
  const match = expression.exec(xml);
  return match?.[1] ? xmlToText(match[1]) : undefined;
}

export function normalizeWhitespace(value: string): string {
  return value
    .replace(/\r/g, "")
    .replace(/[\t ]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}
