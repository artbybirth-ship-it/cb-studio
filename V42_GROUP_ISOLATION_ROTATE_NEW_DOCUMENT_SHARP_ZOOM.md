# V42 — Group Isolation, Rotation, New Document & Sharp Zoom

This build extends V41 without removing the tight selection, free body-part drag, 64px timeline layers, or Cmd/Ctrl + K keyframing.

## New Document
- New Project now opens a New Document-style panel.
- Presets: Full HD (1920×1080), HD (1280×720), 4K (3840×2160), Standard (640×480).
- Width and height may also be entered manually.
- Project width/height are sent to the backend when the project is created.
- Frame rate is displayed as 30 FPS and the source platform as HTML5 Canvas / CreateJS.

## Whole-character transform
- Four external rotation controls are shown around the tight character selection box.
- Drag a rotation control for free rotation.
- Hold Shift while rotating to snap to 45-degree increments.
- Press R to toggle sticky Rotate mode; press Esc to leave Rotate mode.
- Existing scale handles remain available.
- New characters are inserted at scale 1.0 (100% source/library size), not auto-shrunk by editor insertion logic.

## Body-part group edit
- Double-clicking a body part isolates that body-part group.
- All non-selected character groups fade while isolation is active.
- The selected group receives a tight amber box with:
  - corner scale handles,
  - corner rotate controls,
  - horizontal flip control,
  - drag-to-move behavior.
- Shift + group rotation snaps to 45-degree increments.
- Clicking the blank stage / character outside the selected group exits isolation and restores the full character.
- Group scale and flip are included in body-part keyframes.
- Cmd/Ctrl + K continues to add/update the selected body-part keyframe at the playhead.

## Sharp editor zoom
- CreateJS camera-space vector rendering is activated above 1.25x editor zoom, while a body-part group is open, or whenever detached part edits/keyframes exist.
- CreateJS backing resolution uses qualityScale=3, with support up to 4.
- Camera mode uses the character's original source/library box dimensions, so switching render modes does not change the character's 100% size.
- Camera READY messages provide source-space tight bounds so the selection box stays aligned.

## Timeline
- V41's 64px thick timeline/layer rows are preserved.
