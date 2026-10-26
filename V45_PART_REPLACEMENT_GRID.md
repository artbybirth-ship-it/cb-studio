# V45 — Selected-part replacement tray

This update adds a right-side selected body-part replacement workflow.

## Added
- When you click / isolate a body part such as **Head**, that selected part now appears in the **right-side body-part grid**.
- The right panel now shows:
  - a **body-part grid** for the character
  - the **currently selected source part**
  - a **replacement slot** for the selected part
- You can now upload a **PNG / SVG / JPG / WebP** replacement image for the selected part.
- After upload, the selected part shows a replacement preview inside the editor.
- You can also **clear** the replacement for that part.

## Result
- Click Head → Head becomes the active editable part
- In the right panel, Head appears as the selected item
- Upload a replacement image → the replacement preview is applied to that selected part while editing

## Current scope
- This version supports **image-based replacement assets** for selected parts.
- It does **not yet auto-parse another Adobe Animate ZIP/FLA character pack into replaceable body parts**.
