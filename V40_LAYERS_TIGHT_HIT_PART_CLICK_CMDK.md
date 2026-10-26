# V40 — Compact Layers, Tight Hit Range, Direct Part Selection, Cmd/Ctrl+K

This build keeps the v39 no-authentication behavior and adds the requested editor interactions.

## Timeline layers

- Layers are shown top-to-bottom in visual stacking order.
- Drag the `⋮⋮` handle to move a layer up or down.
- Each layer has a compact `×` delete control.
- Timeline layer rows are reduced to 32 px height.
- Timeline ruler/lane clicks still move the playhead to the clicked time.

## Character selection / hit range

- The visible transform border continues to use runtime alpha-pixel bounds.
- Raster bounds padding was reduced to 0.5 logical pixels.
- The large CreateJS source rectangle no longer acts as the whole-character click/drag area.
- The real whole-character hit/drag area now matches the same tight visible bounds used by the transform box.
- Dragging inside that tight area moves the whole character.

## Automatic first position keyframe

- A character gets a position keyframe at its layer `startTime` as soon as it is selected if that start key does not already exist.
- Newly added talking characters are created with their frame-0 position keyframe already present.
- Selecting a character does not create a Motion range.

## Direct body-part selection

- The body-part thumbnail list is no longer shown by default.
- Select the character first, then click directly on a visible body part to open only that part in the right editor.
- Clicking a different visible body part while part-edit mode is active switches to that part.
- Whole Character Mode exits part editing.

## Body-part keyframe shortcut

- macOS: `Cmd + K`
- Windows/Linux: `Ctrl + K`

When a body part is active, the shortcut adds/updates a keyframe for that part at the current playhead.
When no body part is active but a character is selected, the same shortcut adds/updates the whole-character position keyframe.

## Authentication

Authentication remains disabled, matching v37-v39. Login/signup routes continue to use the existing no-auth flow.
