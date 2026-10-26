# V65 — Direct part click + head hit-test fix

## Fixed
- A normal click on a visible character body part now selects that part when the pointer did not move.
- Dragging still moves the whole character, so click and drag remain separate gestures.
- Head/Face hit-testing now has a rendered-bounds fallback for Animate/CreateJS symbols whose centre may not return a useful pixel hit.
- Clicking the middle of the face/head should now reliably select the Head / Face group.
- Existing double-click selection remains available.

## Expected behavior
- Click the centre of Head / Face → Head group opens.
- Click another body part → previous group closes and the new part opens.
- Drag without releasing → whole character moves instead of selecting a part.
