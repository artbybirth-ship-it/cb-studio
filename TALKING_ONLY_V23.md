# CB Studio v23 — Talking.zip Only

This build keeps the existing CB Studio editor rules but removes all previous bundled character data.

## Character data
Only the user-supplied `Talking.zip` source is bundled.

Runtime uses the original Adobe Animate HTML5 Canvas **image asset** export:
- 30 FPS
- 160 frames
- 5.33 seconds
- original `animation.js` copied byte-for-byte
- original SVG, bitmap assets and source sound included

The complete supplied Talking source bundle, including FLA/SVG and the image/texture/spritesheet exports, is preserved under `source_assets/Talking/`.

## Independent body parts
The Talking character is mapped to semantic source parts:
- Head / Face
- Left/Right Upper Arm
- Left/Right Forearm
- Left/Right Hand
- Torso / Shirt
- Dhoti sections
- Left/Right Lower Leg
- Left/Right Foot

Each part can be selected from an actual runtime thumbnail, dragged anywhere on the white editor canvas, rotated, hidden/shown and recolored.

## Per-part source animation
Every body part has its own **Animate / Frozen** control.
- Animate All
- Freeze All
- Animate Selected Only
- Pause/Resume selected part

No replacement/generated character movement is added. When a body part is animated, it follows only its original Adobe Animate/CreateJS source motion plus the user's editor offset.
