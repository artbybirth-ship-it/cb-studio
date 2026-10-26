# V52 — Auto-fit + real Annoyed head rig animation

This update fixes the two issues visible in the V51 screenshot: the replacement head was not fitting the neck area correctly, and the replacement was not showing the real Annoyed head motion.

## What changed
- Annoyed Head now runs through the actual `Onethird` parent rig instead of playing `lib.Head` by itself.
- The source `Onethird` timeline drives the Head child, so its original position / rotation / synced facial timeline is preserved.
- All other rig children are hidden inside the replacement player; only the Head child is rendered.
- The replacement is measured at a stable source frame and auto-fitted once, then that same transform is kept while animation runs. This preserves animation movement instead of re-centering every frame.
- Head is bottom-anchored so it sits on the neck instead of floating above it.
- Men Talk head replacement now uses a stable head slot rather than temporary edit hit-test bounds.
- Original Men Talk head remains hard-hidden while the Annoyed replacement is active.

## Annoyed source behavior used
The provided Animate export places `lib.Head` as `Onethird.instance` and animates that instance's Y position, rotation and synced startPosition across the action. V52 now follows that parent animation directly.
