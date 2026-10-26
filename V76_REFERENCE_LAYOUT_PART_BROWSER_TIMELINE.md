# V76 — Reference layout browser, part-focused right panel, and timeline drag/resize

## What changed

1. **First screen right panel now behaves like a character browser**
   - Right side shows **all HTML5 reference characters** in the closer requested browser layout.
   - You can **click a card** to place the editable character on the canvas.
   - You can also **drag a card and drop it on the canvas**.
   - The selected reference character is remembered and then reused inside the right-side reference panel after placement.

2. **After character placement, the right side continues with the same reference layout**
   - The selected character tab uses the chosen reference character.
   - Similar character cards remain below.

3. **Part workflow is closer to the requested behavior**
   - Single-click whole character selection remains the outer box flow.
   - Double-click/second-click part workflow still opens part editing.
   - In part mode, the right panel now shows:
     - **same-character parts first**
     - **similar replacement options below**
   - Clicking a right-side option applies a replacement to the selected part.

4. **Timeline now supports clip adjustment**
   - Whole clip can be **dragged left/right**.
   - Clip edges can be **resized from left or right**.
   - This is intended to feel closer to the requested timeline control flow.

## Important note
- The browser uses the uploaded/reference HTML5 character thumbnails on the right side.
- Actual editable source on canvas still uses the existing working animate-source character pipeline, so this version focuses on the **requested layout + interaction flow** with the currently available source asset system.
