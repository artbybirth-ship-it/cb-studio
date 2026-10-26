# V86 — Ultra Zoom + Click-to-Color

## Added
- Raised editor zoom ceiling from **50x** to **200x**
- Added **100x** quick zoom button in the editor and character panel
- Dynamic **qualityScale** now follows editor zoom so character players stay much sharper at high zoom
- Talking player quality cap raised from **4** to **16**
- Kallu combined CreateJS players now render to a **high-resolution backing canvas** based on qualityScale instead of a fixed 640×900 canvas
- Full Color Picker now supports:
  - **Selected clicked part** (auto-targeted when a body part is selected)
  - **Skin / Body**
- Added clearer helper text: selecting **Torso** lets you recolor **clothes / upper body**

## Updated files
- `frontend/components/StageCanvas.tsx`
- `frontend/components/EditorShell.tsx`
- `frontend/components/CharacterEditPanel.tsx`
- `frontend/public/characters/talking/player.html`
- `frontend/public/characters/talking/men/player.html`
- `frontend/public/characters/talking/women/player.html`
- `frontend/public/html5-combined-players/kallu/*/player.html`

## Result
- High zoom preserves quality much better
- Click any editable part, then use **Full Color Picker** to recolor that selected part
- For clothes, click the **torso / upper body** region and change its color
