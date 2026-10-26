# V56 — single replaced head + direct double-click/drag editing

This update fixes the two issues visible in the previous screenshot.

## 1. Duplicate head removed
When a moved/replaced body part switched the editor into full-stage camera mode, the replacement was being drawn twice:
- once inside the character placeholder, and
- once as the full-stage camera replacement.

V56 renders the replacement only once in camera mode, so moving the head no longer creates a second copy.

## 2. Replaced head can be moved directly
The replacement no longer tries to drag the hidden original CreateJS head.

Workflow:
1. Double-click the replaced Head / Face.
2. Its edit box opens around the replacement.
3. Drag the box/head directly left, right, up or down.
4. The head can travel across the full stage.
5. Corner handles continue to scale the replacement.
6. Rotate and flip continue to affect the replacement.

## 3. Placement math corrected
Part offsets are source-character coordinates. V55 applied those offsets as CSS percentages/pixels using the wrong scale. V56 converts them using the character's real scale and editor zoom.

Camera-mode placement now uses:
- character X/Y,
- source width/height,
- character scale,
- editor zoom,
so the replacement remains attached to the character instead of jumping to a second location.

## Expected head behavior
- Apply Annoyed Head: only one replacement head appears.
- Default downward snap places it near the neck.
- Double-click Head / Face, then drag: the same single head follows the pointer.
- No old/duplicate replacement should remain behind.
