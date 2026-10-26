# V63 — Part-only selection + fixed-size controls + canvas shortcuts

## Changes
- Cmd/Ctrl + `+` and Cmd/Ctrl + `-` now control **canvas zoom only**. They no longer scale the selected head/body part and browser zoom is prevented inside the editor.
- When Head/Face is selected, only the **Head/Face group box** is shown. The whole-character/body selection box is hidden.
- Only one body-part group is open at a time; opening a new group replaces the previous active group.
- Body-part transform controls now counter-scale using the actual stage scale, so the scale/rotate/flip controls remain approximately the same visual size while zooming in or out.
- Arrow keys move the selected part by 1 unit; Shift + Arrow moves by 10 units.
- Press **Enter** to play/pause the animation.
- Esc closes the active body-part group.
