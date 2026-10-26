# V59 — Keyboard shortcut initialization fix

## Fixed
The V58 keyboard-shortcut effect referenced `moveCharacterPart` and `transformCharacterPart` before those `const` callbacks had been initialized. React evaluates the effect dependency array during render, which caused:

`Cannot access 'moveCharacterPart' before initialization`

The keyboard listener has now been moved below both callback declarations.

## V58 shortcuts retained
- Arrow keys: move selected part by 1px
- Shift + Arrow: move selected part by 10px
- Cmd/Ctrl + `+`: scale selected part up
- Cmd/Ctrl + `-`: scale selected part down
- Esc: exit part editing
- Lighter fade for non-selected body parts
- Full body stays visible after replacement
