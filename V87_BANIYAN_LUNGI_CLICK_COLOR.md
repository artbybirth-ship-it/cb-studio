# V87 — Baniyan / Lungi Click-to-Color

## New behavior
- Kallu now exposes two extra selectable garment parts from the combined CreateJS bundle:
  - **Baniyan / Vest**
  - **Lungi / Lower Cloth**
- Click/double-click the vest area on canvas → **Baniyan / Vest** becomes the active part.
- Click/double-click the lower cloth → **Lungi / Lower Cloth** becomes the active part.
- For garment parts, the right panel automatically switches to the **Colors** tab.
- Color picker changes only that selected garment zone.
- Skin color remains a separate control.
- High-quality zoom changes from V86 are retained.

## Files changed
- `frontend/components/CharacterEditPanel.tsx`
- every `frontend/public/html5-combined-players/kallu/*/player.html`

## Usage
1. Add/select Kallu.
2. Double-click the character to enter part editing.
3. Click the white vest area.
4. Right panel opens **Baniyan / Vest Color**.
5. Pick a color. Only the vest zone changes.
