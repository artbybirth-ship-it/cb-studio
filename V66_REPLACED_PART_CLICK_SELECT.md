# V66 — Replaced part single-click selection fix

This update fixes the case where the whole-character selection box was already visible and clicking the replaced head inside it did not open Head / Face edit mode.

## Cause
The whole-character tight hit layer was above the persistent replacement layer. A click on the visible replacement head was therefore handled as a whole-character click and source hit-testing could not find the old hidden head.

## Fixed
- Replaced head/part layer now sits above the whole-character hit layer.
- A normal single click on a replaced part immediately selects that part.
- Double-click still works as a fallback.
- Once the Head / Face group opens, the whole-character selection box closes and only the selected part box remains.
- Active body-part controls remain above the replacement artwork, so drag/scale/rotate handles still work.
