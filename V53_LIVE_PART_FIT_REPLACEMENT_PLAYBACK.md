# V53 — Exact old-part fit + replacement playback fix

This version addresses the two problems visible in V52: the replacement head was clipped/floating away from the neck, and its animation was not visibly advancing.

## Auto-fit changes
- The original Animate player now reports **exact bounds for every body part at READY**, not only when the user clicks a part.
- StageCanvas stores those source bounds and uses the old Head / Face bounds as the replacement slot.
- This also works after reopening a project where the original head is already hidden.
- Fallback head placement was reduced and moved closer to the real head slot for cases where bounds are unavailable.
- V52 saved replacement URLs are migrated at render time automatically; users do not need to clear/reapply the Annoyed Head.

## Animation changes
- The Annoyed replacement player now instantiates the replacement MovieClip in **independent** mode instead of `single` mode.
- The head is now the direct `lib.Head` symbol fitted into the original head slot. This keeps it attached to the neck instead of using the larger Onethird motion rig viewport.
- The replacement follows the editor playhead and also runs an internal requestAnimationFrame playback loop while Play is active, preventing the replacement from appearing frozen if parent seek messages are sparse.
- Head frames loop across 0–173 and keep the original Annoyed nested face / eyes / lips timeline.

## Expected result
1. Old Men Talk head remains hidden.
2. Annoyed Head appears in the exact old Head / Face slot.
3. It stays attached to the character instead of floating above it.
4. Press Play: the Annoyed Head's own source timeline visibly advances.
