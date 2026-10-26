# V70 — Center-locked whole-character scaling

This update fixes whole-character drift while making the assembled character bigger or smaller.

## Fixed
- Whole-character scaling now keeps the character's world X/Y position fixed.
- Scaling no longer repositions the character around the visual/pivot bounds.
- Replaced head/body parts still scale together with the body because they remain local to the character group.
- The whole-character group can be scaled repeatedly without walking left/right/up/down.

## Expected behavior
1. Place and adjust the replacement head.
2. Single-click to select the whole assembled character.
3. Drag a scale handle.
4. Body + replacement scale together around the same fixed character center.
