import { readFileSync } from "node:fs";
import path from "node:path";

export interface WeightedName {
  name: string;
  weight: number;
}

export interface MerchantGrammar {
  category: string;
  patterns: string[];
}

export interface NameDictionaryPack {
  locale: string;
  givenNames: WeightedName[];
  familyNames: WeightedName[];
  merchantGrammars: MerchantGrammar[];
  /** Placeholder word lists referenced by merchant grammar patterns, e.g. `words.place`. */
  words: Record<string, string[]>;
}

interface WeightedNameFile {
  locale: string;
  source: string;
  entries: WeightedName[];
}

interface MerchantGrammarFile {
  locale: string;
  source: string;
  grammars: MerchantGrammar[];
  words: Record<string, string[]>;
}

function packDir(locale: string): string {
  return path.join(import.meta.dirname, "../../data/name-packs", locale);
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

const cache = new Map<string, NameDictionaryPack>();

/** Loads a locale's name-dictionary pack (D18) — static, sourced data files shipped
 * with the engine, selected by the spec's `locale` key. Cached per process since
 * packs are immutable, read-only data. */
export function loadNamePack(locale: string): NameDictionaryPack {
  const cached = cache.get(locale);
  if (cached) return cached;

  const dir = packDir(locale);
  const given = readJson<WeightedNameFile>(path.join(dir, "given-names.json"));
  const family = readJson<WeightedNameFile>(path.join(dir, "family-names.json"));
  const merchants = readJson<MerchantGrammarFile>(path.join(dir, "merchant-grammars.json"));

  const pack: NameDictionaryPack = {
    locale,
    givenNames: given.entries,
    familyNames: family.entries,
    merchantGrammars: merchants.grammars,
    words: merchants.words,
  };
  cache.set(locale, pack);
  return pack;
}
