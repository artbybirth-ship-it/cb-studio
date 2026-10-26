# CB Studio v36 - Selection, Centre Point, Audio Layer and Create Motion

This build adds the workflow marked in the supplied editor reference image.

## Added

- Selection tool keeps the normal click/drag workflow and now shows a transform bounding box.
- Eight resize handles provide uniform scale directly on the canvas.
- A visible centre/pivot point is shown on the selected object and can be dragged to reposition the transform pivot.
- Audio can be imported directly from the left toolbar or Timeline toolbar. The audio is created as its own timeline layer at the current playhead.
- Audio timeline clips now use the real detected audio duration.
- `Create Motion` is available in the left toolbar and Timeline toolbar.
- Create Motion creates an editable one-second position-keyframe range and moves the playhead to the end key. Drag the character there to define the destination.
- Motion ranges are displayed as a cyan clip in the timeline between the first and last position keyframes.

## Existing behaviour retained

- Original Adobe Animate/CreateJS character animation remains intact.
- Whole-character drag, body-part editing, AI Animate, background generation, MP4 rendering and undo/redo remain available.
- When position keyframes already exist, dragging the character at the playhead updates/creates the position key at that frame.
