"use client";

import { useEffect, useState } from "react";
import type { Html5CharacterLibraryCharacter } from "@/lib/html5CharacterCatalog";

/**
 * Part variants straight from installed Animate exports: every library symbol named like a body
 * part (Head, Headcopy…Headcopy13), rendered by /vendor/cb-symbol-player.html in a hidden frame.
 * No backend support is needed, so Docker (Django) and desktop (Next.js) installs behave alike.
 */

export type PartVariant = { symbol: string; label: string; thumb: string };
export type ExportSource = { js: string; comp: string };
export type CharacterPartVariants = {
  character: Html5CharacterLibraryCharacter;
  source: ExportSource;
  variants: PartVariant[];
};

const SYMBOL_PLAYER = "/vendor/cb-symbol-player.html";
const sourceCache = new Map<string, Promise<ExportSource | null>>();
const catalogCache = new Map<string, Promise<PartVariant[]>>();

/** Symbol base name for an editor part key: "head" → "Head", "leftForearm2" → "LeftForearm". */
export const partSymbolBase = (partKey: string) => {
  const key = String(partKey || "").replace(/\d+$/, "");
  return key ? key.charAt(0).toUpperCase() + key.slice(1) : "";
};

/** Player URL that draws one library symbol (used as a "source-symbol" part replacement). */
export const symbolPlayerUrl = (source: ExportSource, symbol: string) =>
  `${SYMBOL_PLAYER}?${new URLSearchParams({ js: source.js, comp: source.comp, symbol }).toString()}`;

/** Pose symbols of a split Animate export ("Front (isolated Animate pose)" → Front), labelled by action name. */
const posesOf = (character: Html5CharacterLibraryCharacter) => character.actions
  .map((action) => ({ symbol: /^(.+?) \(isolated Animate pose\)$/.exec(action.sourceSvgName || "")?.[1] || "", label: action.actionName }))
  .filter((pose) => pose.symbol);

/** The export script and composition a character's player loads, read from its player HTML. */
export const exportSourceOf = (character: Html5CharacterLibraryCharacter): Promise<ExportSource | null> => {
  const playerUrl = character.actions[0]?.assetUrl || "";
  if (!playerUrl) return Promise.resolve(null);
  let pending = sourceCache.get(playerUrl);
  if (!pending) {
    pending = fetch(playerUrl).then((response) => response.ok ? response.text() : "").then((html) => {
      const scripts = Array.from(html.matchAll(/<script[^>]+src="([^"]+)"/gi), (match) => match[1])
        .filter((src) => !/\/vendor\/|createjs/i.test(src));
      const comp = /COMP=("(?:[^"\\]|\\.)*")/.exec(html)?.[1] || "";
      const compId = comp ? JSON.parse(comp) as string : /getComposition\(\s*["']([^"']+)["']/.exec(html)?.[1] || "";
      if (!scripts[0] || !compId) return null;
      const js = new URL(scripts[0], new URL(playerUrl, window.location.href)).pathname;
      return { js: decodeURI(js), comp: compId };
    }).catch(() => null);
    sourceCache.set(playerUrl, pending);
  }
  return pending;
};

let requestCounter = 0;
/** Runs the symbol catalog for one export in a hidden frame; cached per export and part. */
const loadCatalog = (source: ExportSource, partBase: string, poses: { symbol: string; label: string }[]): Promise<PartVariant[]> => {
  const cacheKey = `${source.js}|${source.comp}|${partBase.toLowerCase()}`;
  let pending = catalogCache.get(cacheKey);
  if (pending) return pending;
  pending = new Promise<PartVariant[]>((resolve) => {
    const req = `catalog-${Date.now()}-${++requestCounter}`;
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;left:-10000px;top:0;width:200px;height:200px;border:0;visibility:hidden;pointer-events:none";
    let done = false;
    const finish = (items: PartVariant[]) => {
      if (done) return;
      done = true;
      window.removeEventListener("message", onMessage);
      window.clearTimeout(timer);
      frame.remove();
      resolve(items);
    };
    const onMessage = (event: MessageEvent) => {
      if (event.source !== frame.contentWindow || event.data?.source !== "characterbazaarstudio-symbols" || event.data?.req !== req) return;
      const items = Array.isArray(event.data.items) ? event.data.items : [];
      finish(items.filter((item: PartVariant) => item && item.symbol).map((item: PartVariant) => ({ symbol: String(item.symbol), label: String(item.label || item.symbol), thumb: String(item.thumb || "") })));
    };
    const timer = window.setTimeout(() => finish([]), 45000);
    window.addEventListener("message", onMessage);
    frame.src = `${SYMBOL_PLAYER}?${new URLSearchParams({ catalog: "1", js: source.js, comp: source.comp, part: partBase, poses: JSON.stringify(poses), req }).toString()}`;
    document.body.appendChild(frame);
  });
  // A failed/empty run is not cached, so a later visit can try again.
  pending.then((items) => { if (!items.length) catalogCache.delete(cacheKey); });
  catalogCache.set(cacheKey, pending);
  return pending;
};

/**
 * Variants of one part for the edited character (own) and for the other library characters
 * (similar), each export scanned once. Characters sharing the edited character's export are skipped.
 */
export function usePartVariants(own: Html5CharacterLibraryCharacter | undefined, library: Html5CharacterLibraryCharacter[], partKey: string | null, enabled: boolean) {
  const [state, setState] = useState<{ loading: boolean; own: CharacterPartVariants | null; similar: CharacterPartVariants[] }>({ loading: false, own: null, similar: [] });
  const partBase = partKey ? partSymbolBase(partKey) : "";
  const libraryKey = library.map((character) => character.id).join("|");

  useEffect(() => {
    if (!enabled || !own || !partBase) { setState({ loading: false, own: null, similar: [] }); return; }
    let cancelled = false;
    setState({ loading: true, own: null, similar: [] });
    (async () => {
      const ownSource = await exportSourceOf(own);
      const ownResult = ownSource
        ? { character: own, source: ownSource, variants: await loadCatalog(ownSource, partBase, posesOf(own)) }
        : null;
      if (cancelled) return;
      setState({ loading: true, own: ownResult, similar: [] });
      const seen = new Set(ownSource ? [`${ownSource.js}|${ownSource.comp}`] : []);
      const others: { character: Html5CharacterLibraryCharacter; source: ExportSource }[] = [];
      for (const character of library) {
        if (character.id === own.id || others.length >= 8) continue;
        const source = await exportSourceOf(character);
        const key = source ? `${source.js}|${source.comp}` : "";
        if (!source || seen.has(key)) continue;
        seen.add(key);
        others.push({ character, source });
      }
      const similar = (await Promise.all(others.map(async ({ character, source }) => ({
        character, source, variants: await loadCatalog(source, partBase, posesOf(character)),
      })))).filter((entry) => entry.variants.length > 0);
      if (!cancelled) setState({ loading: false, own: ownResult, similar });
    })().catch(() => { if (!cancelled) setState((current) => ({ ...current, loading: false })); });
    return () => { cancelled = true; };
    // libraryKey stands in for the library array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, own?.id, partBase, libraryKey]);

  return state;
}
