# V83 — Kallu visible library previews + color controls

## Fixes

- Kallu combined-symbol cards now use the live internal CreateJS player as the thumbnail source instead of depending on `preview.png` loading.
- This fixes the case where the card existed and worked when clicked, but the right panel showed an empty white preview.
- The selected Kallu symbol remains clickable and switches the canvas character action as before.

## Color controls

A new/retained **Colors** tab is available in the right panel.

It provides:
- Whole Character Hue
- Whole Character Saturation
- Whole Character Brightness
- Body / Skin Tint
- Selected body-part tint when a part is active
- Reset / clear controls and skin-tone swatches

For the combined Kallu bundle, the player receives `CHARACTER_EDITS` from the editor and applies skin/body tint to the supported zones: head, left/right hands, and left/right legs.
