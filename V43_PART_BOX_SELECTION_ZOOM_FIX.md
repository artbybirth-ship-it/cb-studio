# V43 — Part selection box + zoom-selection stability fix

This update focuses on the body-part selection workflow.

## Fixes
- Double-clicking a body part now keeps the interaction in the **normal character box first**, so selecting the head/hand/leg does not visually "zoom out" the character.
- The selected body part now uses a dedicated **tight selection box** around the selected part itself.
- The part box continues to support:
  - drag / move
  - scale from the 4 corner handles
  - rotate from the 4 rotate handles
  - horizontal flip
  - Shift = 45° rotation snapping
- Blank canvas click still exits part mode and restores the full character.

## Internal stability changes
- Body-part bounds are now tracked separately for:
  - `source` space (normal embedded character box)
  - `camera` space (full-stage sharp zoom / detached-part mode)
- This prevents the wrong bounds from being reused when switching between normal mode and camera mode.
- Camera rendering now activates only when needed for:
  - sharp editor zoom (>1.25x), or
  - actual detached part edits
- A simple part selection alone no longer forces the camera-mode transition.

## Result
- Better visible selection around the chosen part
- More predictable part editing
- No unwanted zoom-out feeling when selecting a body part
