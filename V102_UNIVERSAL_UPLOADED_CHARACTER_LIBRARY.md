# V102 — Universal Uploaded Character Library

This update adds a persistent, server-backed character-library import flow.

## What changed

- Upload a character library ZIP from the Dashboard or from **All characters** in the editor.
- The uploaded library is stored globally (`project = null`), so it appears in every project.
- Built-in and uploaded characters are merged into one universal catalog.
- All discovered actions are shown under the character in the editor browser.
- Uploaded HTML5/CreateJS characters remain valid after Save/Open; they are no longer removed by the old hard-coded URL filter.
- Raw Adobe Animate HTML5 Canvas exports get a lightweight CharacterBazaar Studio bridge for READY / PLAY / PAUSE / SEEK messages.
- Existing `player.html` packages are also supported.
- ZIP extraction blocks path traversal and applies file/count/expanded-size limits.

## ZIP layouts supported automatically

Recommended folder layout:

```text
My Library.zip
  Character Name/
    Action 01/
      player.html              # or the original Adobe Animate .html
      animation.js             # or the matching Animate .js
      preview.svg              # optional; PNG/JPG also supported
    Action 02/
      ...
```

A flat Adobe Animate export is also accepted:

```text
My Library.zip
  Character Name/
    Character Action_HTML5 Canvas.html
    Character Action_HTML5 Canvas.js
    Character Action_HTML5 Canvas.svg
```

If no preview image is present, Studio generates a placeholder thumbnail so the action still appears in the library.

## Optional explicit manifest

For deterministic naming/grouping, a ZIP may contain `cb-library.json`:

```json
{
  "characters": [
    {
      "id": "my-character",
      "name": "My Character",
      "actions": [
        {
          "id": "front-talk",
          "actionName": "Front Talk",
          "player": "My Character/Front Talk/player.html",
          "preview": "My Character/Front Talk/preview.svg",
          "sourceWidth": 1080,
          "sourceHeight": 1920,
          "fps": 30,
          "durationMs": 6000
        }
      ]
    }
  ]
}
```

All paths in the manifest must point inside the uploaded ZIP.
