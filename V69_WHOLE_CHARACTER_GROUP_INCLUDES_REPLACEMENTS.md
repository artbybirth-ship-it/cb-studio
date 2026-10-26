# V69 — Whole character group includes replaced parts

This update makes a placed replacement part (for example the Annoyed head) behave as part of the complete character group when you return to whole-character selection.

## Fixed
- After the replacement head is placed and part-edit mode is closed, the whole-character selection box now expands to include the replacement head too.
- The whole group bounds are calculated from both the original character body and all placed replacement parts.
- Replacement offset, scale, rotation and flip are included when calculating the whole-character group box.
- Scaling the whole-character box continues to scale the body and replacement head together because the replacement remains inside the character transform.

## Workflow
1. Double-click Head / Face to position or scale the replacement head.
2. Single-click the character/replacement to return to whole-character mode.
3. The full grouping box now surrounds body + replacement head together.
4. Scale the whole box to make the complete character bigger or smaller as one unit.
