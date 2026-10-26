import type { Html5CharacterLibraryCharacter } from "@/lib/html5CharacterCatalog";

// Display names for library characters and poses, cleaned from Animate file/symbol names:
// "Shambhu Character html5" → "Shambhu Character", "Onethirdcopy5" → "One third 5",
// "Drinkingtea" → "Drinking tea", "Front_1" → "Front 1". Files on disk keep their names.

// Words used to split run-together lowercase names. A token is only split when every
// piece is a known word, so names like "Shambhu" are never broken up.
const WORDS = new Set(`
one two three four five six seven eight nine ten eleven twelve first second third fourth fifth quarter half full double single
front back side left right top bottom center centre middle view views turn turned turning around profile angle angled close
walk walking walks run running runs idle stand standing stands sit sitting sits seated sat lie lying lay kneel kneeling crouch crouching squat
lean leaning bend bending bow bowing jump jumping hop climb climbing fall falling push pushing pull pulling kick kicking throw throwing
punch fight fighting dance dancing wave waving clap clapping point pointing nod nodding shrug shrugging greet greeting namaste pray praying
drink drinking eat eating cook cooking read reading write writing work working sleep sleeping wake waking rest resting wait waiting
talk talking speak speaking say saying shout shouting call calling listen listening think thinking look looking watch watching
smile smiling laugh laughing cry crying blink blinking happy sad angry surprised shocked scared worried confused excited tired proud neutral
hold holding carry carrying pick picking give giving take taking open opening close closing fold folded cross crossed
tea coffee water milk cup glass plate food phone book bag stick umbrella bench chair table bed door basket pot
hand hands arm arms leg legs foot feet head face eye eyes mouth lip lips body pose poses expression
up down on off in out over under with and of the at to from for by
action actions loop cycle start end begin intro outro default base main alt alternate version ver take shot scene new old final
copy man woman boy girl child kid baby person farmer villager character characters
`.split(/\s+/).filter(Boolean));

/** Split one lowercase token into known words (fewest pieces), or return null. */
const segment = (token: string): string[] | null => {
  const n = token.length;
  const best: Array<string[] | null> = new Array(n + 1).fill(null);
  best[0] = [];
  for (let end = 1; end <= n; end += 1) {
    for (let start = Math.max(0, end - 14); start < end; start += 1) {
      const prefix = best[start];
      const piece = token.slice(start, end);
      if (!prefix || !WORDS.has(piece)) continue;
      if (piece.length === 1) continue;
      const candidate = [...prefix, piece];
      if (!best[end] || candidate.length < best[end]!.length) best[end] = candidate;
    }
  }
  return best[n];
};

/** Pose names only: an unknown start followed by known words, e.g. "carringbag" → "carring bag". */
const segmentTail = (token: string): string[] | null => {
  for (let cut = 4; cut <= token.length - 3; cut += 1) {
    const tail = segment(token.slice(cut));
    if (tail && tail.every((word) => word.length >= 3)) return [token.slice(0, cut), ...tail];
  }
  return null;
};

const tokensOf = (raw: string) => String(raw || "")
  .replace(/\.html?$/i, "")
  .replace(/html\s*5?/gi, " ")
  .replace(/[_\-.]+/g, " ")
  .replace(/([a-z])([A-Z])/g, "$1 $2")
  .replace(/([A-Za-z])(\d)/g, "$1 $2")
  .replace(/(\d)([A-Za-z])/g, "$1 $2")
  .split(/\s+/)
  .filter(Boolean);

const cleanTokens = (raw: string, pose = false) => {
  const words: string[] = [];
  let hadCopy = false;
  for (const token of tokensOf(raw)) {
    const lower = token.toLowerCase();
    let pieces = /^[a-z]+$/i.test(token) && !WORDS.has(lower) ? segment(lower) : null;
    if (!pieces && /^[a-z]+$/i.test(token) && !WORDS.has(lower)) {
      // "copy" is dropped even inside words the list cannot fully split ("Carringbagcopy").
      const rest = lower.includes("copy") ? lower.replace(/copy/g, "") : lower;
      if (rest !== lower) hadCopy = true;
      pieces = (rest && (WORDS.has(rest) ? [rest] : segment(rest) || (pose ? segmentTail(rest) : null))) || (rest !== lower ? (rest ? [rest] : []) : null);
    }
    for (const word of pieces || [token]) {
      if (word.toLowerCase() === "copy") { hadCopy = true; continue; }
      words.push(pieces ? word : token);
    }
  }
  const text = words.join(" ").trim();
  return { text: text ? text.charAt(0).toUpperCase() + text.slice(1) : "", hadCopy };
};

export const cleanCharacterName = (raw: string) => cleanTokens(raw).text || String(raw || "").trim() || "Character";

/** Clean every character and pose name. Poses that only differed by "copy" get the next free number. */
export const cleanLibraryNames = (characters: Html5CharacterLibraryCharacter[]): Html5CharacterLibraryCharacter[] =>
  characters.map((character) => {
    const name = character.userNamed ? character.name : cleanCharacterName(character.name);
    const cleaned = character.actions.map((action) => ({ action, ...cleanTokens(action.actionName, true) }));
    const used = new Set<string>();
    const names = new Map<string, string>();
    // Originals claim their names first, so "Front" stays "Front" and "Frontcopy" becomes "Front 2".
    for (const pass of [false, true]) {
      for (const entry of cleaned) {
        if (entry.hadCopy !== pass) continue;
        const base = entry.text || "Pose";
        let label = base;
        if (used.has(label.toLowerCase())) {
          const stem = base.replace(/\s+\d+$/, "");
          let number = 2;
          while (used.has(`${stem} ${number}`.toLowerCase())) number += 1;
          label = `${stem} ${number}`;
        }
        used.add(label.toLowerCase());
        names.set(entry.action.id, label);
      }
    }
    return {
      ...character,
      name,
      actions: character.actions.map((action) => ({
        ...action,
        characterName: name,
        actionName: names.get(action.id) || action.actionName,
      })),
    };
  });
