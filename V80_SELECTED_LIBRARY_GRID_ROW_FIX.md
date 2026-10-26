# V80 — Selected Library Blank Panel Root Fix

## Root cause
The Character Edit panel always used three CSS grid rows: a 64px header, the main content row, and a 56px footer.
When the reference browser was opened, the header and footer were conditionally hidden, but the grid rows were not changed. The browser therefore became the first child and was placed into the old 64px header row. That is why only the tabs were visible and the rest of the panel looked blank.

## Fix
- Added `cb-browser-mode` to the Character Edit panel whenever the reference browser is active.
- In browser mode the panel now uses a **single full-height grid row**.
- The browser scroll area now fills the complete right panel.
- Tabs and search remain sticky while all selected-character actions scroll below.
- Existing V79 selected-character mapping is retained.

## Expected result
Select Bansi/Shambhu/Suresh/Raghu on canvas -> right panel immediately shows search + every mapped action card + Similar Characters, instead of a blank grey area.
