# V62 — Zoom alignment: single coordinate system

This update fixes character / replacement misalignment after repeated canvas zoom in and zoom out.

## Root cause
The editor used to switch the character into a separate full-stage camera renderer when canvas zoom became greater than 1.25x. A replaced Head / Face was rendered separately, so crossing the zoom threshold could put the body and replacement into different coordinate systems. This is why the head could become huge, move away from the neck, or appear cut after zooming back out.

## Fixed
- Canvas zoom no longer changes the character rendering mode.
- Body + replaced Head / Face stay inside the same stage-world coordinate system at every editor zoom level.
- Replacement part transforms no longer trigger camera mode.
- Camera mode is now used only for a genuinely detached ORIGINAL source body part without a replacement.
- Browser-zoom stability wrapper from V61 is retained.
- Annoyed replacement source quality is increased to `qualityScale=4` for a sharper zoomed preview.

## Expected result
- Zoom in with Canvas Zoom.
- Zoom back out, including below 1x.
- Character body and replacement head should stay attached and preserve the same relative position / scale.
- Browser zoom and Canvas Zoom should no longer cause the replacement to jump into a different coordinate system.
