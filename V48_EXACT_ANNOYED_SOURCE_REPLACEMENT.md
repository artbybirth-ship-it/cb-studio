# V48 — Exact Annoyed Animate Source Replacement

This version fixes the previous replacement-library implementation.

## What was wrong before
V46/V47 used manually recreated SVG placeholder art for the Annoyed head/hand/body library. That meant selecting **Annoyed Head** did not insert the actual head from the supplied Adobe Animate source.

## What V48 changes
- Removes the recreated SVG replacement assets.
- Copies the supplied Annoyed Animate source into the project.
- Uses the actual CreateJS symbols exported from `21.Annoyed_HTML5 Canvas.js`.
- The replacement library now renders source symbols through a dedicated vector symbol player:
  - `Head`
  - `LeftHand`
  - `RightHand`
  - `Torso`
- `Annoyed Head — Exact Source` uses the real `lib.Head` symbol from the supplied export.
- The original selected source part is hidden when a replacement is applied, so the replacement is visually obvious instead of merely sitting over the original art.
- Replacement overlays persist after leaving body-part edit mode using the last known body-part bounds.
- Double-clicking an already replaced part reopens that part for editing.
- Existing move / scale / rotate / flip controls continue to work around the selected part box.

## Source preserved
The supplied files are retained under:
`source_assets/Annoyed/`

The runtime replacement source is under:
`frontend/public/replacement-libraries/annoyed/exact/`
