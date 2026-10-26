/*
 * CharacterBazaar Studio — shared Adobe Animate (CreateJS) player bridge, v2.
 *
 * Every installed character player (desktop Next.js installs and Docker/Django
 * installs alike) loads this one file:
 *   <script src="/vendor/cb-animate-bridge.js?v=2" data-cb-bridge data-width="720" data-height="960" data-fps="30"></script>
 *
 * Editor → player messages (source "characterbazaarstudio-editor"):
 *   SEEK, PAUSE, PLAY, CHARACTER_EDITS, HIT_TEST_PART, BEGIN/MOVE/END_PART_DRAG,
 *   SET_VIEW { pixelScale, x, y, width, height }  — device pixels per player CSS px and
 *            the visible part of the player (0..1). The vectors are redrawn at exactly that
 *            resolution, for the visible region only, so zooming never pixelates.
 * Player → editor messages (source "characterbazaarstudio-animate"):
 *   READY, CONTENT_BOUNDS, PART_SELECTED, PART_DRAG_PREVIEW, PART_DRAG_END, ERROR
 */
(function () {
  var script = document.currentScript;
  var ds = (script && script.dataset) || {};
  var W = Math.max(1, Number(ds.width) || 1080);
  var H = Math.max(1, Number(ds.height) || 1920);
  var FPS = Math.max(1, Number(ds.fps) || 30);
  // Backing-store limits for the visible-region canvas (per side and total pixels).
  var MAX_EDGE = 8192;
  var MAX_AREA = 40e6;

  var cbReadySent = false, cbDrag = null, cbParts = {}, cbFallbackLayer = null, cbTintLayer = null, cbDimLayer = null, cbFocusPart = '';
  var cbView = null, cbScanCanvas = null, cbLastBounds = null, cbScanTimer = 0, cbTightCanvas = null, cbSelectedPart = '';
  var defs = [
    { key: 'head', label: 'Head / Face', rx: /(head|face|skull|hair|turban|pagdi)/i, zone: [.34, .04, .32, .22] },
    { key: 'baniyan', label: 'Upper Clothes', rx: /(baniyan|vest|shirt|tshirt|t-shirt|upper.?cloth|jacket|kurta|blouse)/i, zone: [.31, .24, .38, .30] },
    { key: 'lungi', label: 'Lower Clothes', rx: /(lungi|dhoti|pant|trouser|lower.?cloth|skirt|pyjama|pajama)/i, zone: [.30, .55, .40, .25] },
    { key: 'leftHand', label: 'Left Hand / Arm', rx: /(left.*(hand|arm|palm|forearm)|(hand|arm|palm|forearm).*left|l[_-]?(hand|arm))/i, zone: [.12, .31, .25, .28] },
    { key: 'rightHand', label: 'Right Hand / Arm', rx: /(right.*(hand|arm|palm|forearm)|(hand|arm|palm|forearm).*right|r[_-]?(hand|arm))/i, zone: [.63, .31, .25, .28] },
    { key: 'leftLeg', label: 'Left Leg / Foot', rx: /(left.*(leg|foot|thigh|knee)|(leg|foot|thigh|knee).*left|l[_-]?(leg|foot))/i, zone: [.30, .66, .20, .30] },
    { key: 'rightLeg', label: 'Right Leg / Foot', rx: /(right.*(leg|foot|thigh|knee)|(leg|foot|thigh|knee).*right|r[_-]?(leg|foot))/i, zone: [.50, .66, .20, .30] },
    { key: 'torso', label: 'Torso / Body', rx: /(torso|body|chest|trunk)/i, zone: [.28, .23, .44, .39] }
  ];

  function cbRoot() { try { return window.exportRoot || (typeof exportRoot !== 'undefined' ? exportRoot : null); } catch (e) { return null; } }
  function cbStage() { try { return window.stage || (typeof stage !== 'undefined' ? stage : null); } catch (e) { return null; } }
  function cbCanvas() { var st = cbStage(); return (st && st.canvas) || document.getElementById('canvas'); }
  function cbPost(type, extra) { try { parent.postMessage(Object.assign({ source: 'characterbazaarstudio-animate', type: type }, extra || {}), '*'); } catch (e) {} }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  function looksDisplayObject(v) { return !!(v && typeof v === 'object' && (typeof v.localToGlobal === 'function' || typeof v.getBounds === 'function' || Array.isArray(v.children))); }
  function nodeLabel(node, hint) { var ctor = ''; try { ctor = node && node.constructor && node.constructor.name || ''; } catch (e) {} return [hint, node && node.name, node && node.id, ctor].filter(Boolean).join(' '); }
  function classify(label) { for (var i = 0; i < defs.length; i++) { if (defs[i].rx.test(label)) return defs[i].key; } return ''; }
  // Computed bounds can be absurd (degenerate masks after an AS3 → Canvas conversion report ±5e8); Animate's nominalBounds are then used.
  function rawBounds(node) { try { var b = node.getBounds && node.getBounds(), nb = node.nominalBounds; if (b && nb && (b.width > nb.width * 5 || b.height > nb.height * 5)) b = nb; if (!b && nb) b = nb; if (!b && node.getTransformedBounds) b = node.getTransformedBounds(); return b || null; } catch (e) { return null; } }

  // Global (canvas pixel) point → stage units (the W×H Animate coordinate space). The
  // stage itself is scaled by SET_VIEW, so bounds must undo the stage transform.
  function toStage(p) {
    var st = cbStage();
    if (!st) return p;
    try { if (st.globalToLocal) return st.globalToLocal(p.x, p.y); } catch (e) {}
    return { x: (p.x - (st.x || 0)) / (st.scaleX || 1), y: (p.y - (st.y || 0)) / (st.scaleY || 1) };
  }
  function globalPoint(node, x, y) {
    var g;
    try { if (node.localToGlobal) g = node.localToGlobal(x, y); } catch (e) {}
    if (!g) { try { if (node.parent && node.parent.localToGlobal) g = node.parent.localToGlobal((node.x || 0) + x, (node.y || 0) + y); } catch (e) {} }
    if (!g) return { x: (node.x || 0) + x, y: (node.y || 0) + y };
    return toStage(g);
  }
  function boundsFor(node) {
    var b = rawBounds(node);
    if (!b) return null;
    try {
      var pts = [globalPoint(node, b.x, b.y), globalPoint(node, b.x + b.width, b.y), globalPoint(node, b.x + b.width, b.y + b.height), globalPoint(node, b.x, b.y + b.height)];
      var xs = pts.map(function (p) { return Number(p.x) || 0; }), ys = pts.map(function (p) { return Number(p.y) || 0; });
      var x = Math.min.apply(Math, xs), y = Math.min.apply(Math, ys), r = Math.max.apply(Math, xs), bt = Math.max.apply(Math, ys);
      if (r - x < 2 || bt - y < 2) return null;
      return { x: clamp(x / W, 0, 1), y: clamp(y / H, 0, 1), width: clamp((r - x) / W, .001, 1), height: clamp((bt - y) / H, .001, 1) };
    } catch (e) { return null; }
  }
  function zoneFor(key) { for (var i = 0; i < defs.length; i++) if (defs[i].key === key) { var z = defs[i].zone; return { x: z[0], y: z[1], width: z[2], height: z[3] }; } return { x: .3, y: .2, width: .4, height: .5 }; }

  // ---- Part discovery. Animate instances are usually unnamed ("instance_9"), but their library
  // symbols carry the rig's names (Head, Torso, LeftArm, Lungi…). Each instance's prototype is
  // its symbol's prototype, so symbol names are read from every loaded Animate library.
  var cbProtoNames = null, cbLibs = [], cbNamedMode = false, cbOrder = [], cbLastOv = {};
  var GENERIC_SYMBOL = /^(clipgroup|group|path|symbol|tween|shape|layer|compoundpath|bitmap|image|mask|anmovieclip|instance|movieclip|container|sprite|graphic|object)\b/i;
  function protoNames() {
    if (cbProtoNames) return cbProtoNames;
    var map = new Map(), libs = [];
    try { var an = window.AdobeAn; if (an && an.compositions) Object.keys(an.compositions).forEach(function (id) { try { libs.push(an.compositions[id].getLibrary()); } catch (e) {} }); } catch (e) {}
    try { if (window.lib) libs.push(window.lib); } catch (e) {}
    libs.forEach(function (lib) { Object.keys(lib || {}).forEach(function (name) { var f = lib[name]; if (typeof f === 'function' && f.prototype && !map.has(f.prototype)) map.set(f.prototype, name); }); });
    if (map.size) { cbProtoNames = map; cbLibs = libs; }
    return map;
  }
  function libSymbol(name) { protoNames(); for (var i = 0; i < cbLibs.length; i++) { var f = cbLibs[i] && cbLibs[i][name]; if (typeof f === 'function') return f; } return null; }
  // "Headcopy13" → "Head", "Scarf_1" → "Scarf"; generic Animate wrappers (Group_7, Path_38…) → ''.
  function partName(node) {
    var raw = ''; try { raw = protoNames().get(Object.getPrototypeOf(node)) || ''; } catch (e) {}
    var base = String(raw).replace(/(?:copy\d*|_\d+)+$/i, '');
    return base && /[a-z]/i.test(base) && !GENERIC_SYMBOL.test(base) ? base : '';
  }
  // Top-most named pieces under a node, looking through unnamed wrappers.
  function namedPieces(node, out, depth) {
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) {
      var name = partName(kids[i]);
      if (name) out.push({ node: kids[i], name: name });
      else if (kids[i].children && depth < 6) namedPieces(kids[i], out, depth + 1);
    }
    return out;
  }
  function discoverNamed(root) {
    var pieces = namedPieces(root, [], 0);
    // A single named wrapper (the pose, or a "Body" symbol) is opened so its pieces become the parts.
    for (var i = 0; i < 3 && pieces.length === 1; i++) { var inner = namedPieces(pieces[0].node, [], 0); if (inner.length < 2) break; pieces = inner; }
    if (pieces.length < 2) return false;
    var parts = {}, order = [], used = {};
    pieces.forEach(function (piece) {
      var key = piece.name.charAt(0).toLowerCase() + piece.name.slice(1), n = 2;
      while (used[key]) key = piece.name.charAt(0).toLowerCase() + piece.name.slice(1) + (n++);
      used[key] = true;
      var old = cbParts[key];
      var label = piece.name.replace(/([a-z])([A-Z])/g, '$1 $2');
      parts[key] = { key: key, label: label.charAt(0).toUpperCase() + label.slice(1), node: piece.node, bounds: old && old.node === piece.node ? old.bounds : null };
      order.push(key);
    });
    cbParts = parts; cbOrder = order; cbNamedMode = true;
    return true;
  }
  function discover() {
    var root = cbRoot(); if (!root) return;
    if (discoverNamed(root)) return;
    cbNamedMode = false;
    var seen = [];
    function has(o) { return seen.indexOf(o) >= 0; }
    function consider(node, hint) {
      if (!looksDisplayObject(node) || has(node)) return;
      seen.push(node);
      var label = nodeLabel(node, hint), key = classify(label), b = key ? boundsFor(node) : null;
      if (key && b) {
        var old = cbParts[key], area = b.width * b.height, oldArea = old && old.bounds ? old.bounds.width * old.bounds.height : 999;
        if (area < oldArea && area > .0003 && area < .75) cbParts[key] = { key: key, label: (defs.filter(function (d) { return d.key === key; })[0] || {}).label || key, node: node, bounds: b };
      }
      try { Object.keys(node).forEach(function (k) { var v = node[k]; if (looksDisplayObject(v) && v !== node) consider(v, k); }); } catch (e) {}
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) consider(kids[i], 'child' + i);
    }
    consider(root, 'root');
    defs.forEach(function (d) { if (!cbParts[d.key]) cbParts[d.key] = { key: d.key, label: d.label, node: null, bounds: zoneFor(d.key) }; });
    cbOrder = defs.map(function (d) { return d.key; });
  }
  // ---- Nested parts: pieces inside a part (Animate's double-click into a symbol). Keys are paths:
  // "head/hair" (a named piece), "head/lips/shape_3" (one drawn shape; ids are the export's own
  // property names, "instance_2.shape" when deeper) and "head/lips/shape_3+shape_7" (several shapes
  // edited together). They resolve lazily from the saved edits and the selection, so they survive
  // reloads and export. A nested edit works in stage space on top of its parent's edit.
  var cbNestedKeys = {};
  function keyOfName(name) { return name.charAt(0).toLowerCase() + name.slice(1); }
  function labelOfName(name) { var l = String(name).replace(/([a-z])([A-Z])/g, '$1 $2'); return l.charAt(0).toUpperCase() + l.slice(1); }
  function childPieces(node) {
    var used = {}, out = [];
    namedPieces(node, [], 0).forEach(function (piece) {
      var id = keyOfName(piece.name), n = 2;
      while (used[id]) id = keyOfName(piece.name) + (n++);
      used[id] = true;
      out.push({ id: id, node: piece.node, label: labelOfName(piece.name) });
    });
    return out;
  }
  // A child's id inside its parent: the property Animate stored it under (shape_3, instance_2…).
  function childId(parent, child) {
    var keys = Object.keys(parent);
    for (var i = 0; i < keys.length; i++) if (keys[i] !== 'parent' && parent[keys[i]] === child) return keys[i];
    return '#' + (parent.children || []).indexOf(child);
  }
  function nodeById(node, id) {
    var segs = String(id).split('.');
    for (var i = 0; i < segs.length && node; i++) node = segs[i].charAt(0) === '#' ? (node.children || [])[Number(segs[i].slice(1))] : node[segs[i]];
    return looksDisplayObject(node) ? node : null;
  }
  // Drawn shapes under a node in drawing order (later = on top), looking through wrappers.
  function shapesUnder(node, path, out) {
    var kids = node.children || [];
    for (var i = 0; i < kids.length; i++) {
      var c = kids[i]; if (!c || c.visible === false) continue;
      var id = (path ? path + '.' : '') + childId(node, c);
      if (c.graphics) out.push({ id: id, node: c });
      else if (c.children) shapesUnder(c, id, out);
    }
    return out;
  }
  function nodesOf(p) { return p ? (p.nodes || (p.node ? [p.node] : [])) : []; }
  function unionBounds(list) {
    list = list.filter(Boolean); if (!list.length) return null;
    var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    list.forEach(function (b) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); });
    return { x: x0, y: y0, width: Math.max(.001, x1 - x0), height: Math.max(.001, y1 - y0) };
  }
  function partTightBounds(p) { return unionBounds(nodesOf(p).map(tightBoundsFor)); }
  function resolvePart(key) {
    key = String(key || ''); if (!key) return null;
    var p = cbParts[key]; if (p && p.node) return p;
    var cut = key.lastIndexOf('/'); if (cut < 0) return p || null;
    var parent = resolvePart(key.slice(0, cut)); if (!parent || !parent.node || parent.nodes) return null;
    var seg = key.slice(cut + 1), nodes = [], label = '';
    var piece = childPieces(parent.node).filter(function (c) { return c.id === seg; })[0];
    if (piece) { nodes = [piece.node]; label = piece.label; }
    else { nodes = seg.split('+').map(function (id) { return nodeById(parent.node, id); }).filter(Boolean); label = nodes.length > 1 ? nodes.length + ' shapes' : 'Shape'; }
    if (!nodes.length) return null;
    var old = cbNestedKeys[key];
    p = { key: key, label: (parent.label ? parent.label + ' \u203a ' : '') + label, node: nodes[0], nodes: nodes.length > 1 ? nodes : null, bounds: old && old.node === nodes[0] ? old.bounds : null, parentKey: parent.key, nested: true };
    cbParts[key] = p; cbNestedKeys[key] = p;
    return p;
  }
  // Editor (same-origin): the piece of part parentKey under (x, y) (0..1 of the player), or else the
  // drawn shape there. add = Shift+click: toggle that shape in the current shape selection `current`.
  window.cbSubPartAt = function (parentKey, x, y, current, add) {
    var parent = resolvePart(parentKey), st = cbStage();
    if (!parent || !parent.node || parent.nodes || !st || !st.localToGlobal) return null;
    if (!visibleAt(Number(x), Number(y))) return { key: '' };
    var g = st.localToGlobal(Number(x) * W, Number(y) * H);
    var hits = function (n) { try { var l = n.globalToLocal(g.x, g.y); return n.visible !== false && !!n.hitTest(l.x, l.y); } catch (e) { return false; } };
    var prefix = parent.key + '/', key = '';
    if (!add) {
      var pieces = childPieces(parent.node);
      for (var i = pieces.length - 1; i >= 0 && !key; i--) if (hits(pieces[i].node)) key = prefix + pieces[i].id;
    }
    if (!key) {
      var shapes = shapesUnder(parent.node, '', []), hit = null;
      for (var j = shapes.length - 1; j >= 0 && !hit; j--) if (hits(shapes[j].node)) hit = shapes[j];
      if (!hit) return { key: '' };
      key = prefix + hit.id;
      current = String(current || '');
      if (add && current.indexOf(prefix) === 0 && current.slice(prefix.length).indexOf('/') < 0 && !childPieces(parent.node).some(function (c) { return prefix + c.id === current; })) {
        var ids = current.slice(prefix.length).split('+'), at = ids.indexOf(hit.id);
        if (at >= 0) ids.splice(at, 1); else ids.push(hit.id);
        if (!ids.length) return { key: '' };
        ids.sort(); key = prefix + ids.join('+');
      }
    }
    var p = resolvePart(key); if (!p) return null;
    p.bounds = partTightBounds(p) || p.bounds;
    return { key: key, label: p.label, bounds: p.bounds };
  };
  // Editor: a part's current (unedited, tight) box and label, nested keys included.
  window.cbPartBoundsOf = function (key) {
    var p = resolvePart(key); if (!p || !p.node) return null;
    p.bounds = partTightBounds(p) || p.bounds;
    return { key: p.key, label: p.label, bounds: p.bounds };
  };
  // Saved edits, the selection and nested parts edited before (so removing an edit resets them).
  function resolveNested(keys) {
    var wanted = {};
    keys.forEach(function (k) { if (k && String(k).indexOf('/') >= 0) wanted[k] = true; });
    Object.keys(cbNestedKeys).forEach(function (k) { wanted[k] = true; });
    Object.keys(wanted).forEach(function (k) { if (!resolvePart(k)) delete cbNestedKeys[k]; });
  }

  function partsPayload() { discover(); refreshBounds(); return cbOrder.map(function (k) { var p = cbParts[k]; return { key: k, label: p.label, bounds: p.bounds || zoneFor(k), thumb: '' }; }); }
  function ensureLayers() { var st = cbStage(); if (!st || !window.createjs) return; if (!cbFallbackLayer) { cbFallbackLayer = new createjs.Shape(); cbFallbackLayer.compositeOperation = 'destination-out'; st.addChild(cbFallbackLayer); } if (!cbTintLayer) { cbTintLayer = new createjs.Shape(); cbTintLayer.compositeOperation = 'source-atop'; cbTintLayer.alpha = .35; st.addChild(cbTintLayer); } }
  function rectMask(g, b) { g.dr(b.x * W, b.y * H, b.width * W, b.height * H); }
  function applyFallbackMasks(ov, colors) {
    ensureLayers();
    if (cbFallbackLayer) { cbFallbackLayer.graphics.clear(); Object.keys(ov || {}).forEach(function (k) { if (ov[k] && ov[k].visible === false && (!cbParts[k] || !cbParts[k].node)) { cbFallbackLayer.graphics.f('#000'); rectMask(cbFallbackLayer.graphics, (cbParts[k] && cbParts[k].bounds) || zoneFor(k)); } }); }
    if (cbTintLayer) { cbTintLayer.graphics.clear(); Object.keys(colors || {}).forEach(function (k) { if (k.indexOf('part:') !== 0) return; var part = k.slice(5), c = colors[k]; if (/^#[0-9a-fA-F]{6}$/.test(String(c || ''))) { cbTintLayer.graphics.f(c); rectMask(cbTintLayer.graphics, (cbParts[part] && cbParts[part].bounds) || zoneFor(part)); } }); }
  }
  // ---- Part edits are layered on top of the Animate timeline instead of overwriting x/y/rotation,
  // so a part keeps its own animation. getMatrix is wrapped per part instance: the edit is applied
  // in stage space exactly like the editor's part box (translate, then rotate/scale about the
  // bottom-centre of the part's unedited bounds), then mapped back into the parent's space.
  // Linear part of a part edit in stage space, A = R·K·S: scale (incl. width/height stretch and flip),
  // then skew, then rotate.
  function stretchOf(v) { return Math.max(.02, Number(v == null ? 1 : v) || 1); }
  function partMatrix(o) {
    var th = Number(o.rotation || 0) * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th);
    var sc = Math.max(.02, Number(o.scale == null ? 1 : o.scale || 1)), sx = sc * stretchOf(o.stretchX) * (o.flipX ? -1 : 1), sy = sc * stretchOf(o.stretchY);
    var tx = Math.tan(Number(o.skewX || 0) * Math.PI / 180), ty = Math.tan(Number(o.skewY || 0) * Math.PI / 180);
    return { a11: sx * (c - sn * ty), a12: sy * (c * tx - sn), a21: sx * (sn + c * ty), a22: sy * (sn * tx + c) };
  }
  function editedMatrix(matrix) {
    var m = Object.getPrototypeOf(this).getMatrix.call(this, matrix);
    var ov = this.__cbOv, par = this.parent;
    if (!ov || this.__cbOvOff || !par || !window.createjs) return m;
    var toParent = function (x, y) { return toStage(par.getConcatenatedMatrix(new createjs.Matrix2D()).transformPoint(x, y, new createjs.Point())); };
    var o0 = toParent(0, 0), ox = toParent(1, 0), oy = toParent(0, 1);
    var a = ox.x - o0.x, b = ox.y - o0.y, c = oy.x - o0.x, d = oy.y - o0.y, det = a * d - b * c;
    if (!det) return m;
    var pm = partMatrix(ov), A11 = pm.a11, A12 = pm.a12, A21 = pm.a21, A22 = pm.a22;
    var M11 = A11 * a + A12 * b, M12 = A11 * c + A12 * d, M21 = A21 * a + A22 * b, M22 = A21 * c + A22 * d;
    var K11 = (d * M11 - c * M21) / det, K12 = (d * M12 - c * M22) / det, K21 = (a * M21 - b * M11) / det, K22 = (a * M22 - b * M12) / det;
    var tx = ov.offsetX + ov.pivotX - (A11 * ov.pivotX + A12 * ov.pivotY), ty = ov.offsetY + ov.pivotY - (A21 * ov.pivotX + A22 * ov.pivotY);
    var vx = A11 * o0.x + A12 * o0.y + tx - o0.x, vy = A21 * o0.x + A22 * o0.y + ty - o0.y;
    var Kx = (d * vx - c * vy) / det, Ky = (a * vy - b * vx) / det;
    return m.setValues(K11 * m.a + K12 * m.b, K21 * m.a + K22 * m.b, K11 * m.c + K12 * m.d, K21 * m.c + K22 * m.d, K11 * m.tx + K12 * m.ty + Kx, K21 * m.tx + K22 * m.ty + Ky);
  }
  // Same-character variant swap (partOverrides[key].swapSymbol, e.g. "Headcopy5"): the part instance
  // stays in the rig, so it keeps its place in the stacking order, the timeline's motion and the
  // user's edit, but draws another library symbol's artwork in its own local space instead.
  function swappedDraw(ctx, ignoreCache) {
    var sw = this.__cbSwap;
    if (!sw) return Object.getPrototypeOf(this).draw.call(this, ctx, ignoreCache);
    var r = sw.inst;
    if (r.gotoAndStop && r.totalFrames > 1) { var f = (this.currentFrame || 0) % r.totalFrames; if (r.currentFrame !== f) r.gotoAndStop(f); }
    r.draw(ctx, ignoreCache);
    return true;
  }
  function swappedBounds() { var sw = this.__cbSwap; return sw ? (sw.inst.getBounds && sw.inst.getBounds()) || sw.inst.nominalBounds || null : Object.getPrototypeOf(this).getBounds.call(this); }
  function applySwap(n, symbol) {
    if (symbol && (!n.__cbSwap || n.__cbSwap.symbol !== symbol)) {
      var C = libSymbol(symbol); if (!C) return;
      var inst = new C(); try { if (inst.gotoAndStop) inst.gotoAndStop(0); } catch (e) {}
      n.__cbSwap = { symbol: symbol, inst: inst }; n.draw = swappedDraw; n.getBounds = swappedBounds;
    } else if (!symbol && n.__cbSwap) { delete n.__cbSwap; delete n.draw; delete n.getBounds; }
  }
  // Bounds of a part as the timeline places it, without the user's edit (what the editor's box expects).
  function baseBoundsFor(node) { node.__cbOvOff = true; var b = null; try { b = boundsFor(node); } finally { node.__cbOvOff = false; } return b; }
  function applyOne(key, o) {
    var p = cbParts[key], list = nodesOf(p); if (!list.length) return;
    if (list.length > 1) { list.forEach(function (node) { applyNode(p, key, node, o, true); }); return; }
    applyNode(p, key, list[0], o, false);
  }
  function applyNode(p, key, n, o, grouped) {
    o = o || {};
    if (n.getMatrix !== editedMatrix) n.getMatrix = editedMatrix;
    if (!grouped && !p.nested) applySwap(n, String(o.swapSymbol || ''));
    if (n.__cbBaseVisible === undefined) n.__cbBaseVisible = n.visible !== false;
    var sc = Math.max(.02, Number(o.scale == null ? 1 : o.scale || 1)), ox = Number(o.offsetX || 0), oy = Number(o.offsetY || 0), rot = Number(o.rotation || 0), flip = !!o.flipX, kx = Number(o.skewX || 0), ky = Number(o.skewY || 0);
    var stx = stretchOf(o.stretchX), sty = stretchOf(o.stretchY);
    if (!ox && !oy && !rot && sc === 1 && !flip && !kx && !ky && stx === 1 && sty === 1) n.__cbOv = null;
    else {
      var b = p.bounds || (grouped ? unionBounds(nodesOf(p).map(baseBoundsFor)) : baseBoundsFor(n)) || partTightBounds(p) || zoneFor(key);
      n.__cbOv = { offsetX: ox, offsetY: oy, rotation: rot, scale: sc, stretchX: stx, stretchY: sty, flipX: flip, skewX: kx, skewY: ky, px: pivotFraction(o.pivotX, .5), py: pivotFraction(o.pivotY, 1) };
      setPivot(n.__cbOv, b);
    }
    n.visible = o.visible === false ? false : n.__cbBaseVisible;
    if (o.animate === false && typeof n.stop === 'function') n.stop();
  }
  // Entered part (CHARACTER_EDITS.focusPart): wash out the artwork outside the part's box so
  // only that part reads at full strength. source-atop keeps the wash on the character's own pixels.
  function applyFocus() {
    var st = cbStage(); if (!st || !window.createjs) return;
    if (!cbDimLayer) { cbDimLayer = new createjs.Shape(); cbDimLayer.compositeOperation = 'source-atop'; cbDimLayer.alpha = .6; }
    if (cbDimLayer.parent !== st || st.getChildIndex(cbDimLayer) !== st.numChildren - 1) st.addChild(cbDimLayer);
    var g = cbDimLayer.graphics; g.clear();
    var p = cbFocusPart && cbParts[cbFocusPart];
    if (!p) return;
    var b = unionBounds(nodesOf(p).map(boundsFor)) || p.bounds || zoneFor(cbFocusPart);
    var x = b.x * W, y = b.y * H, r = (b.x + b.width) * W, bt = (b.y + b.height) * H;
    g.f('#ffffff').dr(0, 0, W, y).dr(0, bt, W, H - bt).dr(0, y, x, bt - y).dr(r, y, W - r, bt - y);
  }
  function applyEdits(d) { discover(); cbSelectedPart = String(d.selectedPart || ''); var ov = d.partOverrides || {}; var ruleScopes = (d.colorReplacements || []).map(function (r) { return String(r && r.scope || ''); }); resolveNested(Object.keys(ov).concat([cbSelectedPart, String(d.focusPart || '')], ruleScopes)); refreshBounds(ov); Object.keys(cbParts).forEach(function (k) { applyOne(k, ov[k] || {}); }); Object.keys(cbNestedKeys).forEach(function (k) { if (!ov[k] && k !== cbSelectedPart && k !== String(d.focusPart || '') && ruleScopes.indexOf(k) < 0) delete cbNestedKeys[k]; }); refreshBounds(ov); applyFallbackMasks(ov, d.colorOverrides || {}); cbColorRules = d.colorReplacements || []; applyRecolor(cbColorRules); cbFocusPart = String(d.focusPart || ''); applyFocus(); var st = cbStage(); if (st && st.update) st.update(); }
  // ---- Tight part bounds: the part alone is drawn off-screen (unedited, in stage units) and its
  // opaque pixels measured, so the box hugs the artwork instead of the symbol's nominal bounds.
  // Only the selected part and edited parts are measured; results are cached per frame/variant.
  function tightBoundsFor(node) {
    var st = cbStage(), nb = baseBoundsFor(node);
    if (!st || !window.createjs || !st.getMatrix) return nb;
    var placed = ''; try { var pm0 = node.parent && node.parent.getConcatenatedMatrix(new createjs.Matrix2D()); if (pm0) placed = [pm0.a, pm0.b, pm0.c, pm0.d, pm0.tx, pm0.ty].map(function (v) { return Math.round(v * 100) / 100; }).join(','); } catch (e) {}
    // Includes where the parent currently draws it, so editing a parent (moving the head) re-measures it.
    var frameKey0 = [cbRoot() && cbRoot().currentFrame, node.currentFrame, node.__cbSwap ? node.__cbSwap.symbol : '', placed].join('|');
    if (!nb) {
      // Drawn shapes carry no bounds in Animate exports: find them on the whole stage first.
      if (node.__cbTight && node.__cbTight.key0 === frameKey0) return node.__cbTight.b;
      nb = scanBounds(node, { x: 0, y: 0, width: 1, height: 1 });
      if (!nb) return null;
      var refined = scanBounds(node, nb) || nb;
      node.__cbTight = { key: '', key0: frameKey0, b: refined };
      return refined;
    }
    var frameKey = [frameKey0, nb.x, nb.y, nb.width, nb.height].join('|');
    if (node.__cbTight && node.__cbTight.key === frameKey) return node.__cbTight.b;
    var b = scanBounds(node, nb) || nb;
    node.__cbTight = { key: frameKey, key0: '', b: b };
    return b;
  }
  // The opaque pixels of `node` alone (unedited) inside area nb (0..1 of the player), measured off-screen.
  function scanBounds(node, nb) {
    var st = cbStage();
    var pad = 4, ox = nb.x * W - pad, oy = nb.y * H - pad, bw = nb.width * W + pad * 2, bh = nb.height * H + pad * 2;
    var k = Math.min(2, 420 / Math.max(1, bw, bh)), cw = Math.max(1, Math.ceil(bw * k)), ch = Math.max(1, Math.ceil(bh * k));
    if (!cbTightCanvas) cbTightCanvas = document.createElement('canvas');
    cbTightCanvas.width = cw; cbTightCanvas.height = ch;
    var ctx = cbTightCanvas.getContext('2d', { willReadFrequently: true }), data = null;
    node.__cbOvOff = true;
    try {
      var m = node.getConcatenatedMatrix(new createjs.Matrix2D()).prependMatrix(st.getMatrix(new createjs.Matrix2D()).invert());
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, cw, ch);
      ctx.setTransform(k, 0, 0, k, -ox * k, -oy * k); ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
      node.draw(ctx, false);
      data = ctx.getImageData(0, 0, cw, ch).data;
    } catch (e) { data = null; } finally { node.__cbOvOff = false; }
    var b = null;
    if (data) {
      var minX = cw, minY = ch, maxX = -1, maxY = -1;
      for (var y = 0; y < ch; y++) for (var x = 0; x < cw; x++) if (data[(y * cw + x) * 4 + 3] > 12) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      if (maxX >= minX && maxY >= minY) b = { x: (ox + minX / k) / W, y: (oy + minY / k) / H, width: Math.max(.001, (maxX - minX + 1) / k / W), height: Math.max(.001, (maxY - minY + 1) / k / H) };
    }
    return b;
  }
  function pivotFraction(v, fallback) { var n = Number(v); return v == null || !isFinite(n) ? fallback : n; }
  // Registration point in stage units: a fraction of the part's (unedited) box; default bottom-centre.
  function setPivot(ov, b) { ov.pivotX = (b.x + ov.px * b.width) * W; ov.pivotY = (b.y + ov.py * b.height) * H; }
  function needsTight(k, ov) { var o = ov ? ov[k] : cbLastOv[k]; return k === cbSelectedPart || k === cbFocusPart || !!(o && (o.offsetX || o.offsetY || o.rotation || o.flipX || o.skewX || o.skewY || (o.scale != null && Number(o.scale) !== 1) || stretchOf(o.stretchX) !== 1 || stretchOf(o.stretchY) !== 1 || o.swapSymbol || o.pivotX != null)); }
  function refreshBounds(ov) { Object.keys(cbParts).forEach(function (k) { var p = cbParts[k], list = nodesOf(p); if (!list.length) return; var tight = needsTight(k, ov), b = unionBounds(list.map(function (n) { return tight ? tightBoundsFor(n) : baseBoundsFor(n); })); if (!b) return; p.bounds = b; list.forEach(function (n) { if (n.__cbOv) setPivot(n.__cbOv, b); }); }); }
  // Named rigs: the topmost part with an opaque pixel under the pointer (Animate-style). Otherwise,
  // or when nothing is hit, the smallest part box containing the point.
  // Is something actually drawn at (x, y) (0..1 of the player) on the rendered canvas, within ~2
  // canvas px? A part's own hit test ignores masks above it, so artwork hidden by a mask would count.
  function visibleAt(x, y) {
    var st = cbStage(), cv = cbCanvas();
    if (!st || !cv || !st.localToGlobal) return true;
    try {
      var g = st.localToGlobal(x * W, y * H), r = 2, x0 = Math.max(0, Math.floor(g.x) - r), y0 = Math.max(0, Math.floor(g.y) - r);
      if (x0 >= cv.width || y0 >= cv.height) return false;
      var d = cv.getContext('2d').getImageData(x0, y0, Math.min(cv.width - x0, r * 2 + 1), Math.min(cv.height - y0, r * 2 + 1)).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] > 16) return true;
      return false;
    } catch (e) { return true; }
  }
  function pixelHit(x, y) {
    var st = cbStage(); if (!cbNamedMode || !st || !st.localToGlobal) return null;
    var g = st.localToGlobal(x * W, y * H);
    for (var i = cbOrder.length - 1; i >= 0; i--) {
      var p = cbParts[cbOrder[i]], n = p && p.node;
      if (!n || n.visible === false || !n.hitTest || !n.globalToLocal) continue;
      try { var l = n.globalToLocal(g.x, g.y); if (n.hitTest(l.x, l.y) && visibleAt(x, y)) return { key: p.key, b: p.bounds || zoneFor(p.key), area: 0 }; } catch (e) {}
    }
    return null;
  }
  // Called directly by the same-origin editor: is there an opaque pixel of this part at (x, y)
  // (0..1 of the player)? null when the part has no real artwork node (guessed zones).
  window.cbPartHitTest = function (key, x, y) {
    var p = resolvePart(key), list = nodesOf(p), st = cbStage();
    if (!list.length || !st || !st.localToGlobal) return null;
    try {
      var g = st.localToGlobal(Number(x) * W, Number(y) * H);
      var any = list.some(function (n) { if (!n.hitTest || n.visible === false) return false; var l = n.globalToLocal(g.x, g.y); return !!n.hitTest(l.x, l.y); });
      return any && visibleAt(Number(x), Number(y));
    } catch (e) { return null; }
  };
  // Called by the editor while the registration point is dragged (x, y = 0..1 of the player) or
  // reset. o = the part's saved edit at the playhead. Returns the new point as a fraction of the
  // part box, plus the offset that keeps the part visually still (q' = off + pv + A (q − pv)).
  window.cbPartPivotAt = function (key, x, y, reset, o) {
    var p = resolvePart(key); if (!p) return null;
    var b = p.bounds || partTightBounds(p); if (!b) return null;
    o = o || cbLastOv[key] || {};
    var px = pivotFraction(o.pivotX, .5), py = pivotFraction(o.pivotY, 1);
    var pvx = (b.x + px * b.width) * W, pvy = (b.y + py * b.height) * H, offx = Number(o.offsetX || 0), offy = Number(o.offsetY || 0);
    var pm = partMatrix(o), A11 = pm.a11, A12 = pm.a12, A21 = pm.a21, A22 = pm.a22, det = A11 * A22 - A12 * A21;
    var nx, ny;
    if (reset) { nx = (b.x + b.width / 2) * W; ny = (b.y + b.height) * H; }
    else { var qx = Number(x) * W - (offx + pvx), qy = Number(y) * H - (offy + pvy); nx = pvx + (A22 * qx - A12 * qy) / det; ny = pvy + (A11 * qy - A21 * qx) / det; }
    var clampF = function (v) { return Math.max(-3, Math.min(4, v)); };
    var fx = clampF((nx / W - b.x) / b.width), fy = clampF((ny / H - b.y) / b.height);
    nx = (b.x + fx * b.width) * W; ny = (b.y + fy * b.height) * H;
    var dx = pvx - nx, dy = pvy - ny;
    return { pivotX: fx, pivotY: fy, dx: dx, dy: dy, offsetX: offx + dx - (A11 * dx + A12 * dy), offsetY: offy + dy - (A21 * dx + A22 * dy) };
  };
  // Edge drag → skew (editor calls this; x/y = 0..1 of the player, o = saved edit at the playhead).
  // In the part's scaled, unrotated frame about the registration point, skewX moves a point on the
  // top/bottom edge sideways by tan(skewX)·y and skewY moves left/right edges by tan(skewY)·x. When the
  // registration point lies on the dragged edge, the opposite edge moves the other way instead.
  window.cbPartSkewAt = function (key, edge, x0, y0, x1, y1, o) {
    var p = resolvePart(key); if (!p) return null;
    var b = p.bounds || partTightBounds(p); if (!b) return null;
    o = o || cbLastOv[key] || {};
    var th = Number(o.rotation || 0) * Math.PI / 180, c = Math.cos(th), sn = Math.sin(th), sc = Math.max(.02, Number(o.scale == null ? 1 : o.scale || 1));
    var dx = (Number(x1) - Number(x0)) * W, dy = (Number(y1) - Number(y0)) * H;
    var u = c * dx + sn * dy, v = -sn * dx + c * dy;
    var px = pivotFraction(o.pivotX, .5), py = pivotFraction(o.pivotY, 1), w = b.width * W * sc * stretchOf(o.stretchX), h = b.height * H * sc * stretchOf(o.stretchY);
    var clampDeg = function (d) { return Math.max(-80, Math.min(80, d)); };
    var tx = Math.tan(Number(o.skewX || 0) * Math.PI / 180), ty = Math.tan(Number(o.skewY || 0) * Math.PI / 180);
    if (edge === 'top' || edge === 'bottom') {
      var yEdge = ((edge === 'top' ? 0 : 1) - py) * h, yOpp = ((edge === 'top' ? 1 : 0) - py) * h;
      tx += Math.abs(yEdge) > h * .02 ? u / yEdge : (Math.abs(yOpp) > 1e-6 ? -u / yOpp : 0);
    } else {
      var xEdge = ((edge === 'left' ? 0 : 1) - px) * w, xOpp = ((edge === 'left' ? 1 : 0) - px) * w;
      ty += Math.abs(xEdge) > w * .02 ? v / xEdge : (Math.abs(xOpp) > 1e-6 ? -v / xOpp : 0);
    }
    return { skewX: clampDeg(Math.atan(tx) * 180 / Math.PI), skewY: clampDeg(Math.atan(ty) * 180 / Math.PI) };
  };
  // Named rigs: a part's pixel at the point or within tol (0..1 of the player) of it; no box fallback,
  // so empty space never selects a part.
  function pixelHitNear(x, y, tol) {
    var offsets = [[0, 0], [tol, 0], [-tol, 0], [0, tol], [0, -tol]];
    for (var i = 0; i < offsets.length; i++) { var h = pixelHit(x + offsets[i][0], y + offsets[i][1]); if (h) return h; }
    return null;
  }
  window.cbAnyPartAt = function (x, y, tol) { if (!cbNamedMode) return null; var h = pixelHitNear(Number(x), Number(y), Number(tol) || 0); return h ? h.key : ''; };
  function hit(x, y) { refreshBounds(); if (cbNamedMode) return pixelHitNear(x, y, 2 / Math.max(W, H)); var px = pixelHit(x, y); if (px) return px; var hits = []; Object.keys(cbParts).forEach(function (k) { var b = cbParts[k].bounds || zoneFor(k); if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) hits.push({ key: k, b: b, area: b.width * b.height }); }); hits.sort(function (a, b) { return a.area - b.area; }); return hits[0] || null; }
  function selectAt(x, y) { var h = hit(x, y); if (!h) return; var p = cbParts[h.key]; var b = p && p.node ? tightBoundsFor(p.node) : h.b; if (p && b) p.bounds = b; cbPost('PART_SELECTED', { partKey: h.key, partBounds: b || h.b }); }
  function startDrag(d) { var key = String(d.partKey || ''), p = cbParts[key], last = cbLastOv[key] || {}; if (!p) return; cbDrag = { key: key, startX: Number(d.normalizedX || 0), startY: Number(d.normalizedY || 0), baseX: Number(last.offsetX || 0), baseY: Number(last.offsetY || 0) }; }
  // Drag preview keeps the part's rotation/scale/flip; the reported bounds stay unedited (the editor adds the offset).
  function moveDrag(d, end) { if (!cbDrag) return; var p = cbParts[cbDrag.key]; if (!p) return; var ox = cbDrag.baseX + (Number(d.normalizedX || 0) - cbDrag.startX) * W, oy = cbDrag.baseY + (Number(d.normalizedY || 0) - cbDrag.startY) * H; var merged = Object.assign({}, cbLastOv[cbDrag.key] || {}, { offsetX: ox, offsetY: oy }); cbLastOv[cbDrag.key] = merged; applyOne(cbDrag.key, merged); var b = p.bounds || (p.node ? baseBoundsFor(p.node) : zoneFor(cbDrag.key)); if (cbFocusPart) applyFocus(); cbPost(end ? 'PART_DRAG_END' : 'PART_DRAG_PREVIEW', { partKey: cbDrag.key, offsetX: ox, offsetY: oy, partBounds: b }); var st = cbStage(); if (st && st.update) st.update(); if (end) cbDrag = null; }

  // ---- Recolour (CHARACTER_EDITS.colorReplacements): Illustrator-style recolour and Animate-style
  // find & replace on the vector artwork itself. Rules: { from, to, target: fill|stroke|both,
  // scope: "*" or a part key, match: exact|shades }. Every fill/stroke/gradient stop is recomputed
  // from its ORIGINAL colour, so rules never chain; for a colour, the last matching rule wins and
  // part rules come after whole-character rules. "shades" moves a colour family together: hue,
  // saturation and lightness keep their offset from the found colour. Bitmaps cannot be recoloured.
  var cbColorRules = [];
  function parseColor(value) {
    var s = String(value || '').trim(), m;
    if ((m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s))) return { r: parseInt(m[1] + m[1], 16), g: parseInt(m[2] + m[2], 16), b: parseInt(m[3] + m[3], 16), a: 1 };
    if ((m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(s))) return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16), a: 1 };
    if ((m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(s))) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
    return null;
  }
  function hexOf(c) { return '#' + [c.r, c.g, c.b].map(function (v) { return ('0' + Math.round(clamp(v, 0, 255)).toString(16)).slice(-2); }).join(''); }
  function cssOf(c) { return c.a >= 1 ? hexOf(c) : 'rgba(' + Math.round(c.r) + ',' + Math.round(c.g) + ',' + Math.round(c.b) + ',' + c.a + ')'; }
  function toHsl(c) {
    var r = c.r / 255, g = c.g / 255, b = c.b / 255, max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, h = 0, s = 0, d = max - min;
    if (d > 1e-6) { s = l > .5 ? d / (2 - max - min) : d / (max + min); h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4; h *= 60; }
    return { h: h, s: s, l: l };
  }
  function fromHsl(h, s, l, a) {
    h = ((h % 360) + 360) % 360; s = clamp(s, 0, 1); l = clamp(l, 0, 1);
    var c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2, r = 0, g = 0, b = 0;
    if (h < 60) { r = c; g = x; } else if (h < 120) { r = x; g = c; } else if (h < 180) { g = c; b = x; } else if (h < 240) { g = x; b = c; } else if (h < 300) { r = x; b = c; } else { r = c; b = x; }
    return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255, a: a };
  }
  function prepareRules(list) {
    return (list || []).map(function (r) { var from = parseColor(r.from), to = parseColor(r.to); return from && to ? { target: r.target || 'both', scope: r.scope || '*', match: r.match === 'shades' ? 'shades' : 'exact', fromHex: hexOf(from), fromHsl: toHsl(from), toRgb: to, toHsl: toHsl(to) } : null; }).filter(Boolean);
  }
  // A colour's shading family: close hue and saturation, lighter/darker within a band. Skin shadows and
  // highlights qualify; distant browns (sandals) do not. Shading in Animate artwork keeps its hue, so a
  // narrow hue band (5°) keeps neighbouring families apart, e.g. skin (24–28°) and a khaki shirt (34–36°).
  function sameFamily(a, b) {
    if (Math.abs(a.l - b.l) > .22) return false;
    if (a.s < .12 && b.s < .12) return true;            // greys belong together
    if (a.s < .12 || b.s < .12) return false;
    var dh = Math.abs(a.h - b.h); dh = Math.min(dh, 360 - dh);
    return dh <= 5 && Math.abs(a.s - b.s) <= .3;
  }
  // An exact rule for this very colour beats any shades rule; otherwise the last matching rule wins.
  function mapColor(c, rules, isStroke) {
    var exact = null, shade = null, hex = hexOf(c), hsl = null;
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i];
      if (r.target !== 'both' && (r.target === 'stroke') !== isStroke) continue;
      if (r.match === 'exact') { if (hex === r.fromHex) exact = { r: r.toRgb.r, g: r.toRgb.g, b: r.toRgb.b, a: c.a }; continue; }
      if (!hsl) hsl = toHsl(c);
      if (!sameFamily(hsl, r.fromHsl)) continue;
      shade = fromHsl(r.toHsl.h + (hsl.h - r.fromHsl.h), r.toHsl.s + (hsl.s - r.fromHsl.s), r.toHsl.l + (hsl.l - r.fromHsl.l), c.a);
    }
    return exact || shade;
  }
  function graphicsList(g) { try { return (g.getInstructions ? g.getInstructions() : g._instructions) || []; } catch (e) { return []; } }
  function originalStyle(ins) {
    if (ins.__cbOrig === undefined) {
      var st = ins.style;
      ins.__cbOrig = typeof st === 'string' ? st
        : st && st.props && (st.props.type === 'linear' || st.props.type === 'radial') ? { props: { type: st.props.type, colors: st.props.colors.slice(), ratios: st.props.ratios.slice(), x0: st.props.x0, y0: st.props.y0, r0: st.props.r0, x1: st.props.x1, y1: st.props.y1, r1: st.props.r1 } }
        : null;
    }
    return ins.__cbOrig;
  }
  // Shapes of the character (or one part), including timeline instances not on the current frame
  // (Animate names them shape, shape_1, instance_3…) and swapped-in variants. fn(shape, partKey).
  function eachShape(start, fn) {
    var partOf = new Map(); Object.keys(cbParts).forEach(function (k) { nodesOf(cbParts[k]).forEach(function (n) { partOf.set(n, k); }); });
    var seen = new Set();
    (function visit(node, partKey) {
      if (!node || typeof node !== 'object' || seen.has(node)) return;
      seen.add(node);
      var key = partOf.get(node) || partKey;
      if (node.graphics) fn(node, key);
      var kids = node.children || [];
      for (var i = 0; i < kids.length; i++) visit(kids[i], key);
      for (var name in node) if (/^(shape|instance)(_\d+)?$/.test(name)) visit(node[name], key);
      if (node.__cbSwap) visit(node.__cbSwap.inst, key);
    })(start, '');
  }
  // "head/hair" is recoloured by rules for "head" and then "head/hair".
  function scopesOf(key) { var out = [], parts = String(key || '').split('/'); for (var i = 1; i <= parts.length; i++) if (parts[0]) out.push(parts.slice(0, i).join('/')); return out; }
  function inScope(partKey, scope) { return scope === '*' || partKey === scope || String(partKey || '').indexOf(scope + '/') === 0; }
  function applyRecolor(list) {
    var root = cbRoot(); if (!root || !window.createjs) return;
    var rules = prepareRules(list), sig = JSON.stringify(list || []);
    var whole = rules.filter(function (r) { return r.scope === '*'; }), byPart = {};
    rules.forEach(function (r) { if (r.scope !== '*') (byPart[r.scope] = byPart[r.scope] || []).push(r); });
    var cached = [];
    eachShape(root, function (shape, partKey) {
      var g = shape.graphics, partSig = sig + '|' + partKey;
      if (g.__cbSig === partSig) return;
      var active = whole; scopesOf(partKey).forEach(function (sc) { if (byPart[sc]) active = active.concat(byPart[sc]); });
      var list = graphicsList(g);
      for (var i = 0; i < list.length; i++) {
        var ins = list[i], isFill = ins instanceof createjs.Graphics.Fill, isStroke = ins instanceof createjs.Graphics.Stroke;
        if (!isFill && !isStroke) continue;
        var orig = originalStyle(ins); if (orig == null) continue;
        if (typeof orig === 'string') {
          var c = parseColor(orig), out = c && active.length ? mapColor(c, active, isStroke) : null;
          ins.style = out ? cssOf(out) : orig;
        } else {
          var p = orig.props, colors = p.colors.map(function (col) { var c2 = parseColor(col), o2 = c2 && active.length ? mapColor(c2, active, isStroke) : null; return o2 ? cssOf(o2) : col; });
          if (p.type === 'linear') ins.linearGradient(colors, p.ratios, p.x0, p.y0, p.x1, p.y1);
          else ins.radialGradient(colors, p.ratios, p.x0, p.y0, p.r0, p.x1, p.y1, p.r1);
        }
      }
      g.__cbSig = partSig;
      for (var n = shape; n; n = n.parent) if (n.cacheCanvas && cached.indexOf(n) < 0) cached.push(n);
    });
    cached.forEach(function (n) { try { n.updateCache(); } catch (e) {} });
  }
  // Colours used in the whole character or one part (original colours, most used first), each with
  // the colour it currently shows. Called directly by the same-origin editor.
  window.cbColorPalette = function (scopeKey) {
    var root = cbRoot(); if (!root || !window.createjs) return [];
    var scoped = scopeKey ? nodesOf(resolvePart(scopeKey)) : [];
    var rules = prepareRules(cbColorRules), found = {};
    (scoped.length ? scoped : [root]).forEach(function (start) { eachShape(start, function (shape, partKey) {
      var active = rules.filter(function (r) { return inScope(partKey, r.scope); });
      var list = graphicsList(shape.graphics);
      for (var i = 0; i < list.length; i++) {
        var ins = list[i], isFill = ins instanceof createjs.Graphics.Fill, isStroke = ins instanceof createjs.Graphics.Stroke;
        if (!isFill && !isStroke) continue;
        var orig = originalStyle(ins); if (orig == null) continue;
        var colors = typeof orig === 'string' ? [orig] : orig.props.colors;
        for (var j = 0; j < colors.length; j++) {
          var c = parseColor(colors[j]); if (!c || c.a < .05) continue;
          var hex = hexOf(c), entry = found[hex] || (found[hex] = { color: hex, fills: 0, strokes: 0, current: hex });
          if (isStroke) entry.strokes++; else entry.fills++;
          var now = mapColor(c, active, isStroke); if (now) entry.current = hexOf(now);
        }
      }
    }); });
    return Object.keys(found).map(function (k) { return found[k]; }).sort(function (a, b) { return (b.fills + b.strokes) - (a.fills + a.strokes); }).slice(0, 80);
  };
  // Eyedropper / Lighten-Darken: the original colour of the top-most visible shape under (x, y)
  // (0..1 of the player), like clicking a fill in Animate. Among that shape's fills, the one whose
  // current colour is closest to the drawn pixel. Falls back to the nearest palette colour.
  window.cbColorAt = function (x, y, scopeKey) {
    var st = cbStage(), cv = cbCanvas(), root = cbRoot(); if (!st || !cv || !root || !st.localToGlobal) return null;
    try {
      var g = st.localToGlobal(Number(x) * W, Number(y) * H), d = cv.getContext('2d').getImageData(Math.floor(g.x), Math.floor(g.y), 1, 1).data;
      if (d[3] < 40) return null;
      var a = d[3] / 255, picked = { r: d[0] / a, g: d[1] / a, b: d[2] / a, a: 1 }, pickedHex = hexOf(picked);
      var dist = function (c) { return Math.pow(c.r - picked.r, 2) + Math.pow(c.g - picked.g, 2) + Math.pow(c.b - picked.b, 2); };
      var rules = prepareRules(cbColorRules);
      var scoped = scopeKey ? nodesOf(resolvePart(scopeKey)) : [];
      // Visible shapes on the current frame, in drawing order (later = on top).
      var top = null;
      (scoped.length ? scoped : [root]).forEach(function visitStart(start) { (function visit(node) {
        if (!node || node.visible === false || node.alpha === 0) return;
        if (node.__cbSwap) { visit(node.__cbSwap.inst); return; }
        if (node.graphics && node.hitTest && node.globalToLocal) {
          try { var l = node.globalToLocal(g.x, g.y); if (node.hitTest(l.x, l.y)) top = node; } catch (e) {}
        }
        var kids = node.children || [];
        for (var i = 0; i < kids.length; i++) visit(kids[i]);
      })(start); });
      if (top) {
        // The deepest part (nested parts included) that contains the shape.
        var partKey = '', best = null, bestDist = Infinity;
        for (var n = top; n && !partKey; n = n.parent) Object.keys(cbParts).forEach(function (k) { if (!partKey && nodesOf(cbParts[k]).indexOf(n) >= 0) partKey = k; });
        var active = rules.filter(function (r) { return inScope(partKey, r.scope); });
        var list = graphicsList(top.graphics);
        for (var i = 0; i < list.length; i++) {
          var ins = list[i], isFill = ins instanceof createjs.Graphics.Fill, isStroke = ins instanceof createjs.Graphics.Stroke;
          if (!isFill && !isStroke) continue;
          var orig = originalStyle(ins); if (orig == null) continue;
          var colors = typeof orig === 'string' ? [orig] : orig.props.colors;
          for (var j = 0; j < colors.length; j++) {
            var c = parseColor(colors[j]); if (!c || c.a < .05) continue;
            var now = mapColor(c, active, isStroke) || c, dd = dist(now) + (isStroke ? 2000 : 0);
            if (dd < bestDist) { bestDist = dd; best = hexOf(c); }
          }
        }
        if (best) return { picked: pickedHex, original: best };
      }
      var nearest = null, nearestDist = Infinity, palette = window.cbColorPalette(scopeKey) || [];
      for (var p = 0; p < palette.length; p++) {
        var pc = parseColor(palette[p].current); if (!pc) continue;
        var pd = dist(pc);
        if (pd < nearestDist) { nearestDist = pd; nearest = palette[p]; }
      }
      return { picked: pickedHex, original: nearest && nearestDist < 3600 ? nearest.color : pickedHex };
    } catch (e) { return null; }
  };

  // ---- Sharp rendering: draw the vectors at the on-screen resolution, visible region only.
  function applyView() {
    var st = cbStage(), cv = cbCanvas();
    if (!st || !cv || !cbView) return;
    var cssW = Math.max(1, window.innerWidth || document.documentElement.clientWidth || W);
    var cssH = Math.max(1, window.innerHeight || document.documentElement.clientHeight || H);
    var v = cbView, s = cv.style;
    if (v.width <= 0 || v.height <= 0) { s.visibility = 'hidden'; return; }
    var q = Math.max(.05, v.scale);
    var bw = v.width * cssW * q, bh = v.height * cssH * q;
    var shrink = Math.min(1, MAX_EDGE / Math.max(bw, bh), Math.sqrt(MAX_AREA / Math.max(1, bw * bh)));
    q *= shrink;
    bw = Math.max(1, Math.ceil(v.width * cssW * q));
    bh = Math.max(1, Math.ceil(v.height * cssH * q));
    // Raw Animate exports wrap the canvas in a fixed-size #animation_container.
    var host = cv.parentElement;
    if (host && host !== document.body && host.id === 'animation_container') {
      host.style.position = 'absolute'; host.style.left = '0'; host.style.top = '0'; host.style.width = '100%'; host.style.height = '100%';
    }
    if (cv.width !== bw) cv.width = bw;
    if (cv.height !== bh) cv.height = bh;
    s.position = 'absolute'; s.display = 'block'; s.visibility = 'visible';
    s.left = (v.x * 100) + '%'; s.top = (v.y * 100) + '%';
    s.width = (v.width * 100) + '%'; s.height = (v.height * 100) + '%';
    st.scaleX = cssW * q / W; st.scaleY = cssH * q / H;
    st.x = -v.x * cssW * q; st.y = -v.y * cssH * q;
    if (st.update) st.update();
  }

  // ---- Tight artwork bounds (stage units), measured from a small offscreen render.
  function scanContentBounds() {
    var st = cbStage();
    if (!st || !st.draw || !st.updateContext) return null;
    var k = Math.min(1, 360 / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
    if (!cbScanCanvas) cbScanCanvas = document.createElement('canvas');
    cbScanCanvas.width = w; cbScanCanvas.height = h;
    var ctx = cbScanCanvas.getContext('2d', { willReadFrequently: true });
    var saved = { sx: st.scaleX, sy: st.scaleY, x: st.x, y: st.y };
    var helpers = [cbFallbackLayer, cbTintLayer, cbDimLayer].filter(Boolean).map(function (l) { var was = l.visible; l.visible = false; return [l, was]; });
    var data = null;
    try {
      st.scaleX = w / W; st.scaleY = h / H; st.x = 0; st.y = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.save(); st.updateContext(ctx); st.draw(ctx, false); ctx.restore();
      data = ctx.getImageData(0, 0, w, h).data;
    } catch (e) { data = null; }
    st.scaleX = saved.sx; st.scaleY = saved.sy; st.x = saved.x; st.y = saved.y;
    helpers.forEach(function (pair) { pair[0].visible = pair[1]; });
    if (!data) return null;
    var minX = w, minY = h, maxX = -1, maxY = -1;
    for (var y = 0; y < h; y++) {
      for (var x = 0; x < w; x++) {
        if (data[(y * w + x) * 4 + 3] > 10) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
      }
    }
    if (maxX < 0) return null;
    return { x: minX / k, y: minY / k, width: (maxX - minX + 1) / k, height: (maxY - minY + 1) / k };
  }
  // ---- Snapshot for project thumbnails (called directly by the same-origin editor):
  // draws the whole player at width×height on a new canvas, at the frame for seekMs
  // (wrapping when loop is true), then restores the live frame. Returns the canvas or null.
  window.cbSnapshot = function (width, height, seekMs, loop) {
    var st = cbStage(), root = cbRoot();
    if (!st || !st.draw || !st.updateContext || !root) return null;
    var w = Math.max(1, Math.round(width || 1)), h = Math.max(1, Math.round(height || 1));
    var snap = document.createElement('canvas'); snap.width = w; snap.height = h;
    var ctx = snap.getContext('2d');
    var saved = { sx: st.scaleX, sy: st.scaleY, x: st.x, y: st.y, frame: root.currentFrame };
    var helpers = [cbFallbackLayer, cbTintLayer, cbDimLayer].filter(Boolean).map(function (l) { var was = l.visible; l.visible = false; return [l, was]; });
    try {
      if (seekMs != null && root.gotoAndStop) {
        var total = Math.max(1, root.totalFrames || 1), f = Math.max(0, Math.round(Number(seekMs) / 1000 * FPS));
        root.gotoAndStop(loop && total > 1 ? f % total : Math.min(total - 1, f));
      }
      st.scaleX = w / W; st.scaleY = h / H; st.x = 0; st.y = 0;
      ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, w, h);
      ctx.save(); st.updateContext(ctx); st.draw(ctx, false); ctx.restore();
    } catch (e) { snap = null; }
    st.scaleX = saved.sx; st.scaleY = saved.sy; st.x = saved.x; st.y = saved.y;
    if (saved.frame != null && root.gotoAndStop) root.gotoAndStop(saved.frame);
    helpers.forEach(function (pair) { pair[0].visible = pair[1]; });
    if (st.update) st.update();
    return snap;
  };

  function nominalContentBounds() {
    var root = cbRoot(), b = root && boundsFor(root);
    return b ? { x: b.x * W, y: b.y * H, width: b.width * W, height: b.height * H } : { x: 0, y: 0, width: W, height: H };
  }
  function contentBounds() { return scanContentBounds() || nominalContentBounds(); }
  function reportBounds() {
    var b = contentBounds(), o = cbLastBounds;
    if (o && Math.abs(o.x - b.x) < 1 && Math.abs(o.y - b.y) < 1 && Math.abs(o.width - b.width) < 1 && Math.abs(o.height - b.height) < 1) return;
    cbLastBounds = b;
    cbPost('CONTENT_BOUNDS', { contentBounds: b });
  }
  function scheduleBounds() { if (cbScanTimer) return; cbScanTimer = setTimeout(function () { cbScanTimer = 0; if (cbRoot()) reportBounds(); }, 120); }

  function cbReady() {
    if (cbReadySent) return;
    var root = cbRoot(); if (!root) return;
    discover();
    cbReadySent = true;
    applyView();
    // Library thumbnails of recoloured My characters pass their rules in the URL (?cbColors=[…]).
    try { var urlRules = new URLSearchParams(location.search).get('cbColors'); if (urlRules) { cbColorRules = JSON.parse(urlRules) || []; applyRecolor(cbColorRules); var stg = cbStage(); if (stg && stg.update) stg.update(); } } catch (e) {}
    var hasReal = Object.keys(cbParts).some(function (k) { return !!cbParts[k].node; });
    cbLastBounds = contentBounds();
    cbPost('READY', { parts: partsPayload(), autoDetected: hasReal, contentBounds: cbLastBounds });
  }
  function cbTryReady() { cbReady(); if (!cbReadySent) setTimeout(cbTryReady, 120); }
  window.addEventListener('load', function () { setTimeout(cbTryReady, 60); });
  setTimeout(cbTryReady, 180);
  // Animate's responsive handler resizes the canvas on window resize; re-apply our view after it.
  window.addEventListener('resize', function () { setTimeout(applyView, 0); });

  window.addEventListener('message', function (event) {
    var d = event.data || {};
    if (d.source !== 'characterbazaarstudio-editor') return;
    if (d.type === 'SET_VIEW') {
      cbView = {
        scale: Number(d.pixelScale) || 1,
        x: clamp(Number(d.x) || 0, 0, 1), y: clamp(Number(d.y) || 0, 0, 1),
        width: clamp(Number(d.width), 0, 1), height: clamp(Number(d.height), 0, 1)
      };
      applyView();
      return;
    }
    var root = cbRoot(), st = cbStage();
    if (!root) return;
    try {
      // loop: wrap past the last frame (Animate "Loop"); otherwise hold the last frame ("Play Once").
      if (d.type === 'SEEK') { var f = Math.max(0, Math.round(Number(d.seekMs || 0) / 1000 * FPS)), total = Math.max(1, root.totalFrames || 1); if (root.gotoAndStop) root.gotoAndStop(d.loop && total > 1 ? f % total : Math.min(total - 1, f)); refreshBounds(); if (cbFocusPart) applyFocus(); if (st && st.update) st.update(); scheduleBounds(); }
      else if (d.type === 'PAUSE') { if (root.stop) root.stop(); }
      else if (d.type === 'PLAY') { if (root.play) root.play(); }
      else if (d.type === 'CHARACTER_EDITS') { cbLastOv = d.partOverrides || {}; applyEdits(d); scheduleBounds(); }
      else if (d.type === 'HIT_TEST_PART') { selectAt(Number(d.normalizedX || 0), Number(d.normalizedY || 0)); }
      else if (d.type === 'BEGIN_PART_DRAG') { startDrag(d); }
      else if (d.type === 'MOVE_PART_DRAG') { moveDrag(d, false); }
      else if (d.type === 'END_PART_DRAG') { moveDrag(d, true); scheduleBounds(); }
    } catch (err) { cbPost('ERROR', { message: String(err) }); }
  });
})();
