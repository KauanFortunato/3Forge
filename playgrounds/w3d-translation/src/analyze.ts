/**
 * Structural analysis of a W3D XML document. No translation happens here —
 * just counts/listings to help the operator understand the shape before
 * writing translation rules.
 */

export interface ElementTypeStats {
  /** Element local name (`Quad`, `TextureText`, `Group`, ...). */
  name: string;
  /** Number of occurrences in the document. */
  count: number;
  /** Sorted list of attribute names ever seen on this element type. */
  attributes: string[];
  /** Up to 5 sample paths (root→element) to help locate the element. */
  samplePaths: string[];
}

export interface DocumentStats {
  totalElements: number;
  maxDepth: number;
  byType: ElementTypeStats[];
}

export function analyzeW3dXml(xml: string): DocumentStats {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, "application/xml");
  const root = doc.documentElement;
  if (!root || doc.querySelector("parsererror")) {
    throw new Error("Invalid XML");
  }

  const perType = new Map<string, { count: number; attrs: Set<string>; paths: string[] }>();
  let totalElements = 0;
  let maxDepth = 0;

  const walk = (el: Element, path: string[], depth: number) => {
    totalElements++;
    if (depth > maxDepth) maxDepth = depth;

    const name = el.tagName;
    const entry = perType.get(name) ?? { count: 0, attrs: new Set<string>(), paths: [] };
    entry.count++;
    for (const attr of Array.from(el.attributes)) {
      entry.attrs.add(attr.name);
    }
    if (entry.paths.length < 5) {
      entry.paths.push([...path, name].join(" > "));
    }
    perType.set(name, entry);

    for (const child of Array.from(el.children)) {
      walk(child, [...path, name], depth + 1);
    }
  };

  walk(root, [], 0);

  const byType: ElementTypeStats[] = Array.from(perType.entries())
    .map(([name, { count, attrs, paths }]) => ({
      name,
      count,
      attributes: [...attrs].sort(),
      samplePaths: paths,
    }))
    .sort((a, b) => b.count - a.count);

  return { totalElements, maxDepth, byType };
}
