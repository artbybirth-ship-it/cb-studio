# V71 — No body-part isolation fade

This update removes the hide/fade behavior during body-part editing.

## Changed
- Double-clicking Head, Hand, Torso or any other body part no longer fades the rest of the character.
- The complete character remains at full opacity while a specific body-part group is selected.
- Part editing still keeps its own selection box and controls.
- Drag, scale, rotate, flip, arrow-key movement, keyframes and replacement-part editing remain available.
- Clicking outside the part exits part-edit mode, but there is no visibility transition because the whole character is already fully visible.

## Replacement behavior
- This does not restore the original source part when that part has intentionally been replaced. For example, if the original Head was replaced, the old Head stays hidden so only the replacement is shown.
