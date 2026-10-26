# V41 — Tight Character Box, Free Body-Part Drag, Thick Layers, Cmd/Ctrl+K

This build updates the editor behavior requested after v40.

## Character selection box

- The visible whole-character transform box stays tight around the rendered character artwork.
- The full 1920×1080 Animate source iframe no longer becomes the clickable/drag area while body-part edit mode is active.
- The transform box remains visible while a body part is being edited; resize handles/pivot are hidden during part editing so part dragging is unambiguous.

## Body-part editing

- Double-click a visible head/body/limb to enter body-part edit mode.
- The selected part gets its own tight amber hit box.
- Drag that tight box and the selected part can be moved freely anywhere across the canvas.
- The player reports updated part bounds while dragging and while seeking the source animation, so the tight hit box follows the selected part.
- Double-click another visible part to switch the active part.
- Escape or Whole Character Mode exits part editing.

## Timeline layers

- Timeline layer rows are increased from the v40 compact 32 px height to 64 px.
- Layer labels, drag/delete controls, source clips, motion ranges, and action lanes are enlarged to match.
- Timeline remains scrollable when many layers are present.

## Keyframes

- macOS: `Cmd + K`
- Windows/Linux: `Ctrl + K`
- With a body part active, the shortcut adds/updates that body-part keyframe at the exact current playhead.
- With only the character active, the shortcut adds/updates the whole-character position keyframe at the exact current playhead.
- Body-part keyframes use a visible amber diamond marker on the timeline.

Authentication remains disabled, matching the supplied v40 project.
