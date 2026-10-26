# V68 — True screen-fixed grouping tools

This update fixes grouping controls changing visual size when the editor canvas is zoomed.

## Changed
- Corner scale squares now remain the same small screen size at any canvas zoom.
- Rotate buttons remain the same screen size and still appear only when the matching corner hover zone is used.
- Part flip control remains the same screen size.
- Whole-character side handles and center pivot remain screen-fixed too.

## Implementation change
Previous versions changed each tool's width/height based on canvas zoom. That could compound with nested character/part transforms. V68 instead keeps compact fixed tool dimensions and counter-scales the entire control wrapper against the inherited canvas/part zoom.

The artwork and selection box can zoom normally; only the UI controls are counter-scaled.
