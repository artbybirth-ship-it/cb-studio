# CB Studio v31 — Whole Character / Explicit Part Mode / Keyframes

- Toolbar zoom now keeps the current viewport center stable. Zoom no longer scales away from the top-left corner.
- Normal character click/drag always moves the complete character, even after zoom/pan.
- A source body part can move only after the user explicitly selects that body-part image from Character Edit.
- Selected source part gets a blue highlight rectangle on the CreateJS canvas.
- Returning to Whole Character Mode clears the source part selection.
- Body-part cards use actual runtime PNG thumbnails generated from isolated source parts.
- Added whole-character position keyframes (X/Y): add/update at playhead, timeline diamonds, jump/delete/clear.
- Once at least one position keyframe exists, dragging the whole character at another playhead automatically creates/updates a position keyframe there.
- Editor evaluates position keyframes at ~30 FPS during playback.
- Static MP4 render harness uses the same linear keyframe interpolation per captured frame.
- Original Talking Adobe Animate/CreateJS animation remains untouched and continues independently of whole-character keyframe motion.
