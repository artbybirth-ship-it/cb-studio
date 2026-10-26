# V60 — Fixed-size controls + selected-part zoom + sharper canvas

## Fixed-size editing controls
- Body-part corner scale handles no longer grow with editor canvas zoom.
- Rotate buttons and flip button also stay approximately the same screen size while the canvas is zoomed.
- The selected-part outline keeps a thinner visual stroke when editor zoom is high.

## Cmd/Ctrl + / - now scales the selected part
- When a body part such as Head / Face is selected:
  - **Cmd/Ctrl + Plus** = make the selected part larger.
  - **Cmd/Ctrl + Minus** = make the selected part smaller.
- These shortcuts no longer trigger the canvas zoom shortcut while a part is selected.
- The shortcut listener runs in capture mode so the browser/canvas does not consume the key first.
- Scale changes use a smooth 5% step.

## Sharper zoom
- Main CreateJS character render quality is increased to qualityScale 4.
- Exact-source replacement symbols use a higher backing-canvas pixel density.
- Camera rendering remains enabled for higher editor zoom, so the character/replacement is redrawn at higher resolution instead of simply stretching a low-resolution image.

## Existing movement shortcuts retained
- Arrow = 1px move selected part.
- Shift + Arrow = 10px move selected part.
- Esc = exit part editing.
