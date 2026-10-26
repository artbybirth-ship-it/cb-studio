# V51 — Hard swap source replacement

This update makes the replacement behave like a hard swap instead of a soft overlay fallback.

## Fixed
- When a source replacement is applied, the original selected source body part is now kept **hidden** instead of temporarily showing through.
- The replacement now uses a **direct placement** strategy for Head / Hands / Torso.
- If live body-part bounds are not available, the editor now uses **fallback placement boxes** so the replacement still appears in the correct area.
- Exact-source replacements now use `pad=0` for the applied stage version, so the replacement fills the part area more directly.

## Result
- Old head should disappear cleanly.
- Annoyed replacement should be visible immediately in the selected part area.
- Replacement continues to run with its own source animation.
