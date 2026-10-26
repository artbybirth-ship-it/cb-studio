#!/usr/bin/env python3
"""Index one Adobe Animate HTML5 Canvas export that contains many top-level library symbols.

Usage:
  python tools/index_combined_html5_bundle.py path/to/animation.js

The script prints the composition/stage metadata and the symbols placed directly on the
exported stage. These symbols can be exposed as separate library cards without splitting
one FLA into many exported files.
"""
from pathlib import Path
import re, json, sys
if len(sys.argv) != 2:
    raise SystemExit("usage: index_combined_html5_bundle.py <animation.js>")
p=Path(sys.argv[1]); text=p.read_text(errors="ignore")
props=text[text.index("// library properties:"):]
meta={
  "compositionId": re.search(r"id:\\s*'([^']+)'", props).group(1),
  "width": int(re.search(r"width:\\s*(\\d+)", props).group(1)),
  "height": int(re.search(r"height:\\s*(\\d+)", props).group(1)),
  "fps": float(re.search(r"fps:\\s*([\\d.]+)", props).group(1)),
}
root_match=re.search(r"// stage content:\\s*\\n\\(lib\\.([A-Za-z0-9_]+) = function", text)
if not root_match: raise SystemExit("stage root not found")
root=root_match.group(1); start=root_match.start(); end=text.index("// library properties:", start); block=text[start:end]
pat=re.compile(r"this\\.(instance(?:_\\d+)?) = new lib\\.([A-Za-z0-9_]+)\\([^\\n]*\\);\\s*\\n\\s*this\\.\\1\\.setTransform\\(([^\\n]+)\\);")
meta["rootSymbol"]=root
meta["stageSymbols"]=[{"instance":m.group(1),"symbol":m.group(2),"transform":[v.strip() for v in m.group(3).split(",")]} for m in pat.finditer(block)]
print(json.dumps(meta,indent=2))
