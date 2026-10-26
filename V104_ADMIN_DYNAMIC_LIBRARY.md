# v104 — Admin Dynamic Character Library

## Requested architecture

- `/admin` is the only character-library management screen.
- Hard-coded admin ID/password are compiled into this build.
- Admin upload/delete endpoints require the admin session cookie.
- `/dashboard` and the Editor are consumers of the shared library only.
- Bundled character assets and hard-coded character catalogs have been removed.
- Uploaded ZIP libraries persist outside the application bundle and appear universally in Studio projects.

## Hard-coded credentials

- ID: `admin`
- Password: `CBStudio@2026`

## Removed bundled content

v104 removes the previous character-specific folders from `frontend/public`, the old `source_assets` bundle, legacy talking catalog, and old generated character mapping records. The Studio starts with an empty Character Library until Admin installs a package.

## Runtime compatibility

Uploaded HTML5/CreateJS actions are patched with a generic Studio bridge at import time. This supplies play/pause/seek, part hit-testing, part movement, visibility, runtime bounds and color-override plumbing without referencing a bundled character name or path.

Part auto-detection uses Animate/CreateJS instance/property/constructor names. Meaningful Animate instance names give the best results. Standard fallback part zones are returned if semantic nodes cannot be discovered. Optional replacement images can be placed in each action's `parts/` folder or declared through the `parts` map in `cb-library.json`; these then appear in the Studio replacement browser dynamically.

## Security note

Hard-coded desktop credentials meet the requested local-admin workflow but are not a strong security boundary for software distributed to untrusted machines. A future hosted/multi-user release should use server-side users, password hashing and authorization instead.
