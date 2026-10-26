# CharacterBazaarStudio v106 — Auto-Split Admin Character Library

## v106 automatic separate-character import

v106 keeps the v105 protected Admin upload flow, but changes how raw Adobe Animate HTML5 Canvas ZIPs are indexed. If one Animate document contains several top-level character symbols on the stage, the importer now creates a separate Studio character for every detected top-level symbol instead of treating the whole stage as one combined character.

The importer also ignores macOS ZIP metadata such as `__MACOSX`, `.DS_Store`, and `._*`, which previously could appear as blank/duplicate library items. Generated isolated-symbol previews are live and use the same CreateJS source, so the user sees each character separately before adding it to the canvas.

The build still contains no bundled/hard-coded character library. Character content is installed only from the protected **Admin Panel** and then becomes available universally in the Studio.

## Admin Panel

Open:

- Desktop/local: `/admin`
- Studio: `/dashboard`

Hard-coded admin credentials for this requested build:

```text
Admin ID: admin
Password: CBStudio@2026
```

Only an authenticated Admin session can upload or delete Character Library ZIP packages. The Studio can read and use the installed library, but it cannot upload/delete character packages.

> Because these credentials are compiled into a desktop application, a determined user can extract them from the packaged app. Change this design to server-side authentication before distributing the app to untrusted users.

## Character library flow

1. Open `/admin` and sign in.
2. Upload a Character Library `.zip`.
3. v106 safely extracts and indexes the package in the app's persistent local-data directory.
4. The Dashboard and Editor read the same dynamic catalog.
5. Every project can use the uploaded characters/actions.
6. Closing and reopening the desktop app does not remove installed libraries.
7. Admin can delete a whole installed package from `/admin`.

There are **no bundled CharacterBazaar character files** in `frontend/public` in v106. Only runtime/static infrastructure such as `render-harness.html` remains.

## Supported uploads

The automatic importer supports:

- Adobe Animate HTML5 Canvas/CreateJS exports.
- Packs containing `player.html` action folders.
- Raw Animate `.html` + sibling `.js` exports. If the stage contains multiple top-level symbols, each is exposed as its own character card automatically.
- Optional `cb-library.json` for exact character/action grouping.

A runtime CreateJS bridge is injected into uploaded actions so the existing Studio controls can work without a character-specific hard-coded path. It attempts to discover common named instances such as head/face, torso/body, hands/arms, legs/feet, and common upper/lower clothing. If the Animate source uses meaningful instance names, part selection/editing is more precise. When names cannot be detected, the bridge provides standard editable fallback regions.

Whole-character transform, timeline/keyframes, action switching, play/seek, color overrides, part transform/hide controls, custom part replacement upload, save/open, and project persistence continue to use the normal Studio pipeline. Exact semantic part discovery cannot be guaranteed for arbitrary third-party Animate exports that contain no usable instance names.

## Optional `cb-library.json`

Example:

```json
{
  "characters": [
    {
      "id": "farmer",
      "name": "Farmer",
      "sourceFolder": "Farmer",
      "actions": [
        {
          "id": "talk-front",
          "name": "Talk Front",
          "player": "Farmer/Talk Front/player.html",
          "preview": "Farmer/Talk Front/preview.png",
          "sourceWidth": 1080,
          "sourceHeight": 1920,
          "fps": 30,
          "durationMs": 6000,
          "parts": {
            "head": "Farmer/Talk Front/parts/head.png",
            "leftHand": "Farmer/Talk Front/parts/leftHand.png",
            "rightHand": "Farmer/Talk Front/parts/rightHand.png"
          }
        }
      ]
    }
  ]
}
```

Paths must remain inside the uploaded ZIP. Without a manifest, v106 also auto-detects common replacement image filenames inside an action's `parts/` folder (for example `head.png`, `torso.svg`, `leftHand.png`, `rightLeg.webp`).

## Desktop persistence

The self-contained Electron build persists projects and Character Library packages in Electron's user-data location. On macOS this is normally under:

```text
~/Library/Application Support/CharacterBazaar Studio/
```

The uploaded assets are stored separately from the DMG/app bundle, so adding characters does not require rebuilding the application.

## Build universal macOS DMG

```bash
cd frontend
rm -rf .next dist
chmod +x build-dmg-universal.sh
./build-dmg-universal.sh
```

v106 keeps the old bundled character/source asset directories removed, so they are no longer copied into every DMG.

## AI and MP4

AI generation and MP4 rendering retain their existing service/runtime requirements. Backend render preflight no longer requires the removed hard-coded talking character files.
