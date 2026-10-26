# V55 — Head snap + replacement preview movement

This update fixes the replaced-head editing behavior.

## Fixed
- Head replacement now gets an **automatic downward snap** when applied, so it lands closer to the neck by default.
- Dragging a replaced body part now shows **live preview movement** on the replacement itself.
- Scaling and rotating a replaced part now also preview correctly on the replacement.
- The original hidden source part now stays **hidden during preview transforms**, so you should not see two heads while moving/scaling/rotating the replacement.

## Result
- Apply Annoyed Head.
- It should auto-place closer to the neck.
- Select Head / Face and drag it: the replacement head should move live.
- Scale/rotate should update the replacement live.
- The original old head should not reappear during editing.
