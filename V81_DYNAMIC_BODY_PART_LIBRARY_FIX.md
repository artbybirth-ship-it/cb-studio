# V81 — Dynamic body-part replacement library fix

This version removes the old Annoyed-specific replacement flow from the part browser.

## Fixed behavior

- Clicking/selecting **Head / Face** opens the selected character's head variants directly.
- Clicking/selecting **Left Hand / Right Hand / Arm / Forearm** opens matching hand variants.
- Clicking/selecting **Torso / Body** opens torso variants.
- Clicking/selecting **Left / Right Leg / Foot** opens matching leg variants.
- The first section contains **all matching variants from the selected character's supplied HTML5 actions**.
- The section underneath contains **similar matching parts from the other supplied characters**.
- Clicking a card applies that card to the currently selected body part.
- The old hard-coded **Annoyed / Expressions special grid is removed from this workflow**.
- The part browser always opens directly on the selected-part tab instead of switching Head to the old Expressions tab.

## Technical fix

The previous build used the raw body-part key in URLs such as:
`.../<partKey>.svg`

But the extracted HTML5 part library only has canonical part files:
- `head.svg`
- `leftHand.svg`
- `rightHand.svg`
- `torso.svg`
- `leftLeg.svg`
- `rightLeg.svg`

V81 normalizes source body-part names such as `Head / Face`, `Left Forearm`, `Right Arm`, `Left Foot`, etc. to those canonical part assets before loading the replacement cards.
