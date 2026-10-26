# V54 — Auto neck fit + manual replacement setting

This update improves replacement-head placement and lets the replaced part be manually set on canvas.

## Fixed
- Annoyed head replacement now uses a **bottom anchor** with zero padding and a stable fit frame so it attaches closer to the neck automatically.
- Replacement overlays now follow the same **part transform** as the selected body-part edit system.
- If you drag / scale / rotate the selected Head / Face body part, the replacement head now moves too.
- The editable hitbox for a selected part now tracks the **replacement slot** instead of only the hidden original source part.

## Result
1. Apply Annoyed Head.
2. It should auto-fit closer to the neck.
3. Double-click Head / Face.
4. Now you can manually:
   - drag left/right/up/down,
   - make it bigger/smaller,
   - rotate,
   - flip,
   while keeping the replacement animation running.
