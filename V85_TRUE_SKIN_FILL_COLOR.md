# V85 — True Skin Fill Color

This build changes Kallu's **Skin / Body Color** from a translucent overlay tint to actual CreateJS source-fill recoloring.

## Fixed

- Skin color no longer paints a magenta/green rectangle-style tint over the character.
- The Kallu combined HTML5 players now walk the live CreateJS display tree and update only skin-like source fill commands.
- Clothing colors are not targeted by the skin palette detector.
- Hair, moustache, black outlines, white vest and teal lungi stay unchanged.
- Original skin shading is preserved by applying the selected skin color with the source fill's relative luminance.
- Clearing Skin / Body Color restores the original source fill colors.
- The skin picker now defaults to Kallu's original source skin base (`#935727`) when no override is set.

## Scope

The true-fill implementation is applied to all 14 Kallu combined-symbol players under:

`frontend/public/html5-combined-players/kallu/*/player.html`

The existing selected-part color control is still a part-zone tint. The **Skin / Body Color** control is now the direct source-fill replacement path.
