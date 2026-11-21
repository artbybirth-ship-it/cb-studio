"""Where a pose open in place is on screen, for the headless tests.

The pose opens where its character stands on the scene (Animate's Edit in Place), so a fixed spot of the stage no longer lands on it.
The stage tells where the pose's own framing lies (data-view.frame: its first frame's ink with a margin, as the stage once showed it),
so a test can still point at "the middle of the pose": fractions of pose_rect() are the spots the tests always used.
`js` is the test's own evaluate function.
"""
import time

_RECT = """(()=>{const e=document.querySelector('[data-testid=native-editor]');const c=e&&e.querySelector('[data-testid=stage]');
  if(!e||!c||!e.dataset.view)return null;const v=JSON.parse(e.dataset.view);if(!v.placed||!v.frame)return null;
  const r=c.getBoundingClientRect();return [r.left+v.frame[0],r.top+v.frame[1],v.frame[2],v.frame[3]]})()"""


def pose_rect(js, seconds=20):
    """[left, top, width, height] on screen of the open pose's framing, once the pose is placed on the scene (None if it never is)."""
    for _ in range(seconds * 4):
        got = js(_RECT)
        if got: return got
        time.sleep(0.25)
    return None


def pose_point(js, fx, fy):
    """The screen point at fractions (fx, fy) of the pose's framing."""
    r = pose_rect(js)
    return (r[0] + r[2] * fx, r[1] + r[3] * fy)


def empty_spot(js):
    """A spot of the stage with nothing on it: the pasteboard at the canvas area's top left."""
    return tuple(js("(()=>{const r=document.querySelector('[data-testid=native-editor] [data-testid=stage]').getBoundingClientRect();return [r.left+12,r.top+12]})()"))
