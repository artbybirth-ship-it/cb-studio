#!/bin/sh
# Compiles frontend/lib/native/ops.ts and runs its assertions (node, no extra packages).
set -e
here=$(cd "$(dirname "$0")" && pwd)
out=$(mktemp -d)
(cd "$here/../../frontend" && npx tsc lib/native/ops.ts lib/native/shapeTween.ts lib/native/library.ts --outDir "$out" --module commonjs --target es2020 --skipLibCheck --moduleResolution node)
cp "$here/ops.test.js" "$out/test.js"
node "$out/test.js"
cp "$here/library.test.js" "$out/library.test.js"
node "$out/library.test.js"

# tweens made in the editor: the layer's keyframe helpers, and the player-side code that makes them play
(cd "$here/../../frontend" && npx tsc lib/symbolKeys.ts --outDir "$out" --module commonjs --target es2020 --skipLibCheck --moduleResolution node --jsx preserve --baseUrl . --paths null >/dev/null 2>&1 || true)
cp "$here/keys_tween.test.js" "$here/bridge_tween.test.js" "$out/"
[ -f "$out/lib/symbolKeys.js" ] && cp "$out/lib/symbolKeys.js" "$out/symbolKeys.js"
node "$out/keys_tween.test.js"
node "$here/bridge_tween.test.js"

# old per-feature edits converted into native timelines
(cd "$here/../../frontend" && npx tsc lib/native/legacy.ts --outDir "$out" --module commonjs --target es2020 --skipLibCheck --moduleResolution node)
cp "$here/legacy.test.js" "$out/legacy.test.js"
node "$out/legacy.test.js"

# the renderer's browser bundle must match the sources
node "$here/build-native-bundle.js" --check
