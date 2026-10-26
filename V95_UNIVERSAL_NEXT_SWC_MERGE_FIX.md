# V95 — Universal DMG Next SWC + Sharp native merge fix

The universal macOS merge was failing after Sharp was allowed because Next.js SWC also installs architecture-specific native binaries (`@next/swc-darwin-arm64` / `@next/swc-darwin-x64`) in both temporary builds.

## Fix
`frontend/package.json` now marks both Sharp/libvips and Next SWC Darwin native binaries as already-architecture-specific resources for the universal merge:

```json
"x64ArchFiles": "{**/node_modules/@img/**/*.{node,dylib},**/node_modules/@next/swc-darwin-*/*.node}"
```

This keeps the architecture-labelled optional packages side by side in the universal app instead of asking `lipo` to merge binaries that are intentionally separate.
