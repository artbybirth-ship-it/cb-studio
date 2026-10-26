# V82 — Kallu combined HTML5 symbol bundle

This version integrates `Kallu Character Preview HTML 5.zip` using its internal Adobe Animate/CreateJS library symbols instead of requiring one exported folder per pose.

## What is indexed
The supplied combined export contains 14 top-level stage symbols. V82 exposes each one as a separate right-side library action:

- Kalucopy3
- Kalucopy2
- Kalucopy
- Kalu_1
- Kalu
- Kalucopy4
- Symbol1copy32
- Kalli
- Kalli_1
- Symbol1copy22
- Kallicopy
- Kallicopy2
- BackthirdWalk
- KalluWalk

## Behavior
- First screen shows **Kallu** as one character library card.
- After adding Kallu to the canvas, the right panel shows all 14 internal symbols as separate cards.
- Clicking an action switches the selected Kallu object to that exact internal symbol player.
- Head / torso / hands / legs continue to use the dynamic body-part browser. V82 also generates matching part thumbnails for every internal Kallu symbol.
- The original FLA, JS, SVG and HTML bundle are preserved in `source_assets/Kallu Combined HTML5/`.

## Reusable architecture
`tools/index_combined_html5_bundle.py` was added so future combined Animate HTML5 exports can be inspected for their top-level internal symbols instead of manually splitting every pose into separate files.
