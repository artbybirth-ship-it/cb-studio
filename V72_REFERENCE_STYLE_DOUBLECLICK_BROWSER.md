# V72 — Reference-Style Double-Click Browser

This update moves the body-part replacement flow closer to the reference images you shared.

## What changed

- **First double-click on a body part**
  - Opens normal part edit mode for that selected part.
  - Full character stays visible.

- **Second double-click on the same body part**
  - Opens a new **reference-style browser panel** in the right sidebar.
  - This panel follows the requested layout style more closely:
    - top tab row
    - back button
    - rounded search field
    - card-style preview grid
    - similar-characters / similar-replacement sections

- **Character/pose style panel**
  - For non-head parts, the browser shows a character-style grid similar to the provided sample.

- **AI faces / expressions style panel**
  - For head/face parts, the browser opens with an **AI faces** style tab first.
  - Head replacement cards can apply the mapped head replacement library items.

## Interaction flow

1. Single click -> whole character selection
2. First double-click on a body part -> part edit mode
3. Second double-click on the same body part -> reference browser panel

## Notes

- The goal here was to match the **workflow and panel format** from your screenshots as closely as possible inside the current MVP structure.
- Existing whole-character editing, part editing, keyframes, drag, scale, rotate, flip, and audio flow remain intact.
- The new browser is designed as a UI/UX alignment step and can be expanded further with more exact source libraries later.
