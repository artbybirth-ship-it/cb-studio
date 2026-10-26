"use client";

import { useMemo, type CSSProperties } from "react";
import { useCharacterLibrary } from "@/lib/characterLibrary";

/**
 * Library thumbnail for a character pose. HTML5 previews are live players whose canvas fills
 * the frame, so the frame is sized to the pose's own proportions (looked up from the library)
 * and centred in the box: the character is never stretched or squashed.
 */
export default function CharacterThumb({ thumbUrl, label }: { thumbUrl?: string; label: string }) {
  const { actions, characters } = useCharacterLibrary();
  // Recoloured My characters show their library colours in thumbnails too.
  const colorParam = useMemo(() => {
    const action = thumbUrl ? actions.find((item) => item.thumbUrl === thumbUrl) : undefined;
    const rules = action ? characters.find((character) => character.id === action.characterId)?.colorReplacements : undefined;
    return rules?.length ? `cbColors=${encodeURIComponent(JSON.stringify(rules.map(({ from, to, target, scope, match }) => ({ from, to, target, scope, match }))))}` : "";
  }, [actions, characters, thumbUrl]);
  const aspect = useMemo(() => {
    const action = thumbUrl ? actions.find((item) => item.thumbUrl === thumbUrl) : undefined;
    return action && action.sourceWidth > 0 && action.sourceHeight > 0 ? action.sourceWidth / action.sourceHeight : 0.75;
  }, [actions, thumbUrl]);
  if (!thumbUrl) return <i>CB</i>;
  const htmlPreview = /\.html(?:\?|$)/i.test(thumbUrl) || thumbUrl.includes("cbPreview=1");
  if (!htmlPreview) return <img src={thumbUrl} alt={label} className="cb-thumb-fit-image" />;
  return (
    <iframe
      src={colorParam ? `${thumbUrl}${thumbUrl.includes("?") ? "&" : "?"}${colorParam}` : thumbUrl}
      title={`${label} preview`}
      tabIndex={-1}
      aria-hidden="true"
      scrolling="no"
      className="cb-thumb-fit"
      style={{ ["--cb-thumb-ar" as string]: String(aspect) } as CSSProperties}
    />
  );
}
