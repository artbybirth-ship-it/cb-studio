# V74 — All HTML5 Characters Browser + Closer Reference Layout

This version updates the Character Edit right panel so the uploaded HTML 5 character set is shown more completely and in a layout closer to the supplied reference design.

## What changed

- Added an always-visible **HTML5 character browser** in **Whole Character Mode**.
- Kept the existing **double-click body-part browser** behavior for part editing.
- Updated the browser so **All characters** now shows **all mapped HTML5 character actions**, grouped by character, instead of only showing one card per character.
- Preserved the exact mapped SVG preview thumbnails already prepared from `HTML 5 Characters.zip`.
- Kept the tabs layout close to the reference:
  - selected character tab
  - All characters
  - Expressions
  - Libraries
  - Blank
- Added grouped headings and better card organization for:
  - Shambhu
  - Bansi
  - Suresh postman
  - Raghu
- Improved panel styling to better match the dark reference layout.

## Behavior

### Whole Character Mode
- The right panel now shows the HTML5 character browser directly.
- You can browse one character at a time or switch to **All characters**.

### Part Edit Mode
- Selecting/double-clicking a body part still opens the reference browser for that part.
- Head/expression browsing continues to work through the **Expressions** tab.

## Notes
- This update focuses on **layout + browsing visibility** of the HTML5 library inside the existing CB Studio edit panel.
- The exact SVG thumbnails remain mapped from the source HTML5 character pack.
