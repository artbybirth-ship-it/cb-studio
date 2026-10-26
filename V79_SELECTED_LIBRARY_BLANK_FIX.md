# V79 — Selected Character Library Blank Panel Fix

This update fixes the issue where the right-side character library became blank after selecting a character on the canvas.

## Fixes

- The first tab is now driven directly by the selected canvas object's `html5:<character-id>` value, not by stale global browser state.
- Selecting Bansi now opens Bansi's complete supplied action library; Shambhu opens Shambhu; Suresh postman opens Suresh postman; Raghu opens Raghu.
- The selected-character tab always renders all supplied action cards from `HTML 5 Characters.zip`.
- The search row and card content are forced visible and no longer depend on sticky/100%-height layout behavior that could leave the panel visually blank.
- `All characters`, `Expressions`, `Libraries`, and `Blank` tabs continue to work.
- Action click still changes the selected canvas character to that exact supplied action.
- Similar characters remain below the selected character's action grid.

## Expected result

After clicking a character on the canvas, the right panel should immediately show:
1. selected character name tab,
2. search field,
3. every supplied action for that selected character,
4. Similar Characters below.
