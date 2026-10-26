# V78 — All selected-character HTML5 libraries visible

This update fixes the right-side library synchronization issue seen after selecting Bansi/Shambhu/etc.

## Fixed
- The right panel now derives the active HTML5 library from the **currently selected canvas character**, instead of relying on a stale global/default Shambhu state.
- Selecting Bansi now opens **Bansi** on the right, Shambhu opens **Shambhu**, Suresh postman opens **Suresh postman**, and Raghu opens **Raghu**.
- Every supplied action from the uploaded HTML 5 Characters pack is shown for the selected character.
- Exact action names from the ZIP are used rather than relabeling the first six Shambhu actions.
- Similar-part results now include **all actions** from the other supplied characters, not only the first two per character.
- The right browser layout was made more robust so the search row and action grid cannot collapse into a blank grey panel.

## Supplied action count
- Shambhu: 6 actions
- Bansi: 8 actions
- Suresh postman: 6 actions
- Raghu: 6 actions
- Total: 26 mapped HTML5 actions

The timeline drag/resize work from V77 is retained.
