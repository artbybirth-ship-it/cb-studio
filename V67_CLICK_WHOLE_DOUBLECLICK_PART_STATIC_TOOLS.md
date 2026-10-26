# V67 — Single-click whole character, double-click part, static compact controls

## Interaction changes
- Single-click anywhere on a character selects the **whole character** and shows only the whole-character grouping box.
- Double-click a visible body part opens **only that part's group**.
- Double-clicking another body part switches to that new part group; the previous part group closes.
- Replaced parts follow the same rule: single-click = whole character, double-click = replaced part.

## Control UI
- Whole-character and body-part transform controls are counter-scaled against editor/browser zoom so they stay a **small, fixed screen size** even when the character is very large or very small.
- Corner scale squares stay compact.
- Rotate controls are hidden by default and appear **only when the pointer hovers that specific corner**.
- The part flip control is also kept compact and fixed-size.
- Sticky `R` rotate mode is disabled for this interaction; rotation is done from the corner-hover rotate control.

## Existing behavior retained
- Enter toggles animation Play/Pause.
- Cmd/Ctrl + +/- remains Canvas Zoom behavior from the previous version.
- Arrow-key body-part movement and the other editor behaviors remain available.
