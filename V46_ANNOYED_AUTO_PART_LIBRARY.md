# V46 — Auto replacement library from Annoyed.zip

This update adds a built-in replacement library generated from the provided **Annoyed.zip** source.

## Added
- New **Auto Replacement Library** in the right panel while a body part is selected.
- The library is grouped by selected part type:
  - **Head**
  - **Hand**
  - **Body**
- Clicking a library card instantly applies that replacement to the currently selected part.
- Existing manual upload/clear replacement workflow remains available.

## Annoyed.zip source mapping used
Detected Animate/CreateJS symbols from the provided source included:
- `Head`
- `Face`
- `Pagdi`
- `RightHand`
- `RightForearm`
- `RightArm`
- `LeftHand`
- `LeftForearm`
- `LrftArm`
- `Torso`
- `Kurta`
- `Neck`

These were mapped into ready-to-use replacement groups:
- **Annoyed Head**
- **Annoyed Right Hand**
- **Annoyed Left Hand**
- **Annoyed Body / Torso**

## Result
- Double-click/select a part on the character.
- Right panel shows the selected part.
- Below it, **Auto Replacement Library** appears.
- Click a replacement card from Annoyed.zip and it gets applied to that selected part.
