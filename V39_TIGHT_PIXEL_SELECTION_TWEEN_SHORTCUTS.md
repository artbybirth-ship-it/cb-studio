# V39 - Tight Pixel Selection, Tween Range, Shortcuts, No Auth

This build keeps the v37/v38 no-authentication flow and adds the requested editor behavior.

## Selection box
- Character selection bounds now come from the actually rendered transparent-canvas pixels instead of the larger source/Animate document bounds.
- The transform box sits immediately around the visible artwork (hat/head top, shoes bottom, and close left/right sides).
- The center point remains draggable.
- Scaling keeps the selected center point fixed, so the character grows/shrinks from that pivot.

## Motion / tween workflow
- Normal timeline clicks only move the vertical playhead. They do not create motion.
- Add/set a position keyframe at the starting point.
- Add/set another position keyframe at the ending point.
- Put the playhead anywhere between those two keyframes and click **Create Motion**.
- The motion range automatically uses the nearest keyframe on the left and the nearest keyframe on the right, and the character is interpolated between them.
- If surrounding keyframes do not exist, Create Motion keeps the previous one-second setup behavior.

## Keyboard shortcuts
- macOS: `Command + Z` = Undo.
- macOS: `Command + Shift + Z` = Redo.
- Windows/Linux: `Ctrl + Z` = Undo, `Ctrl + Shift + Z` = Redo.
- With the mouse cursor over the canvas: `Command/Ctrl + +` = Zoom In.
- With the mouse cursor over the canvas: `Command/Ctrl + -` = Zoom Out.
- With the mouse cursor over the canvas: `Command/Ctrl + 0` = Fit canvas.

## Authentication
- Authentication remains removed for this MVP build.
- Login/sign-up routes continue to go directly to the dashboard.
- Existing no-auth REST API behavior is unchanged.

## UI language
- No Hindi labels were added. New labels/messages are English only.
