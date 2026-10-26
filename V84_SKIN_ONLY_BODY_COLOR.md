# V84 — Skin / Body Color Means Skin Only

Fixed the color-control interpretation requested by the user.

- **Skin / Body Color** now means exposed skin only, not clothes.
- Kallu combined-symbol players now use narrower skin tint zones for:
  - head/face
  - exposed left/right arms and hands
  - lower legs/feet
- Shirt/vest and lower garment are no longer intentionally included in the skin tint zones.
- The former **Whole Character Color** section is renamed **Global Filter** and explicitly says that it affects the whole character including clothes.
- Reset button renamed to **Reset Global Filter**.
- Existing selected-part color, character library, part editing, replacement, and timeline behavior are retained.

Note: Kallu is a combined CreateJS source with generic internal symbols, so the skin-only zones are source-aware approximations around exposed skin areas rather than true semantic fill-color IDs.
