# V91 — Sharp Classic HTML5 Zoom + Cloth Color

## Fixes
- Classic HTML5 characters (including **Suresh postman**) now honor the editor `qualityScale` parameter.
- The CreateJS canvas backing resolution scales up with editor zoom, so vector artwork stays much sharper when zoomed.
- Clicking **Torso / Clothes** automatically opens the Colors tab.
- Suresh postman uniform color now uses true CreateJS source-fill replacement for the khaki fills instead of a raster overlay.
- Shirt/uniform shading is preserved while changing the base color.
- Kallu V90 head/garment/replacement fixes remain unchanged.

## Changed files
- `frontend/components/StageCanvas.tsx`
- `frontend/components/CharacterEditPanel.tsx`
- all `frontend/public/html5-character-players/*/*/player.html`
