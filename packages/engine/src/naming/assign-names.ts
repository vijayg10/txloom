import type { Rng } from "../rng.js";
import { weightedPick } from "../population/weighted-sample.js";
import { randInt } from "../distributions.js";
import type { NameDictionaryPack } from "./pack-loader.js";

/** Draws one consumer/counterparty display name, consuming from whichever Rng
 * the caller passes — a partition's own substream for consumers (cheap,
 * sequential), or a dedicated global substream for merchants (D18, FR-014a). */
export function drawPersonName(pack: NameDictionaryPack, rng: Rng): string {
  const given = weightedPick(pack.givenNames, rng).name;
  const family = weightedPick(pack.familyNames, rng).name;
  return `${given} ${family}`;
}

export function drawMerchantName(pack: NameDictionaryPack, category: string, rng: Rng): string {
  const grammar =
    pack.merchantGrammars.find((g) => g.category === category) ?? pack.merchantGrammars[0];
  if (!grammar) {
    throw new Error(
      `Name pack "${pack.locale}" has no merchant grammar for category "${category}" and no fallback.`,
    );
  }
  const pattern = grammar.patterns[randInt(rng, 0, grammar.patterns.length)]!;
  const family = weightedPick(pack.familyNames, rng).name;
  const placeWords = pack.words.place ?? [];
  const place = placeWords.length > 0 ? placeWords[randInt(rng, 0, placeWords.length)]! : family;
  return pattern.replace("{family}", family).replace("{place}", place);
}
