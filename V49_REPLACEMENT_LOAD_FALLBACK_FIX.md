# V49 — Exact replacement load/fallback fix

## Why the head disappeared in V48
The exact Annoyed replacement iframe was loading the local CreateJS runtime from the wrong URL:

- wrong: `/app/vendor/createjs`
- correct: `/vendor/createjs`

Because of that, the replacement iframe stayed blank. At the same time, V48 immediately set the original selected body part to `visible: false`, so the original head disappeared before the replacement was actually ready.

## Fixed
- Exact Annoyed source-symbol player now loads CreateJS from `/vendor/createjs`.
- Added a replacement READY/ERROR handshake between the source-symbol iframe and the editor.
- The original character body part now remains visible while the replacement is loading.
- The original part is hidden only after the exact replacement reports `READY`.
- If the replacement fails to load, the original part stays visible instead of leaving a blank/missing head.
- The same safety behavior applies to exact source-symbol Head / Hand / Torso replacements.
- Right-panel exact-source previews also use the corrected runtime route.

## Expected flow
1. Select Head / Face.
2. Click `Annoyed Head — Exact Source`.
3. Original head stays visible for the short load period.
4. Exact `lib.Head` from Annoyed source renders successfully.
5. Only then is the original selected Head / Face hidden.
