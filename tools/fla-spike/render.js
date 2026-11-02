// Spike renderer: draws the JSON from fla2json.py on a 2D canvas — layers, masks, nested symbols,
// graphic loop modes, classic tweens (eases, rotation), shape tweens (Animate's MorphShape curves).
(function () {
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---- eases (createjs Ease.get for simple intensity, cubic Béziers for custom eases)
  function easeFn(e) {
    if (!e) return (t) => t;
    if (e.custom && e.custom.length >= 4) {
      const p = e.custom;
      return (x) => {
        for (let i = 0; i + 3 < p.length; i += 3) {
          const [p0, p1, p2, p3] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
          if (x > p3[0] && i + 6 < p.length) continue;
          const bx = (u) => (1 - u) ** 3 * p0[0] + 3 * (1 - u) ** 2 * u * p1[0] + 3 * (1 - u) * u * u * p2[0] + u ** 3 * p3[0];
          let lo = 0, hi = 1;
          for (let k = 0; k < 30; k++) { const m = (lo + hi) / 2; if (bx(m) < x) lo = m; else hi = m; }
          const u = (lo + hi) / 2;
          return (1 - u) ** 3 * p0[1] + 3 * (1 - u) ** 2 * u * p1[1] + 3 * (1 - u) * u * u * p2[1] + u ** 3 * p3[1];
        }
        return x;
      };
    }
    if (e.method && e.method !== "none") {
      const m = e.method.toLowerCase();
      const pow = m.includes("quint") ? 5 : m.includes("quart") ? 4 : m.includes("cubic") ? 3 : 2;
      if (m.endsWith("inout")) return (t) => (t < 0.5 ? 0.5 * (2 * t) ** pow : 1 - 0.5 * Math.abs((2 - 2 * t) ** pow));
      if (m.endsWith("out")) return (t) => 1 - (1 - t) ** pow;
      if (m.endsWith("in")) return (t) => t ** pow;
    }
    // Animate publishes intensity -100 as createjs Ease.get(1) (ease out): the sign is flipped.
    const a = Math.max(-1, Math.min(1, -(e.intensity || 0) / 100));
    if (!a) return (t) => t;
    return a < 0 ? (t) => t * (t * -a + 1 + a) : (t) => t * ((2 - t) * a + (1 - a));
  }

  // ---- classic tween: decompose, interpolate around the transformation point, rebuild
  function decompose(m) {
    const [a, b, c, d] = m;
    return { sx: Math.hypot(a, b), sy: Math.hypot(c, d), ky: Math.atan2(b, a), kx: Math.atan2(-c, d) };
  }
  function angle(a0, a1, t, rot) {
    let delta = a1 - a0;
    while (delta > Math.PI) delta -= 2 * Math.PI;
    while (delta < -Math.PI) delta += 2 * Math.PI;
    if (rot && rot[0] === "clockwise") { if (delta < 0) delta += 2 * Math.PI; delta += 2 * Math.PI * rot[1]; }
    if (rot && rot[0] === "counter-clockwise") { if (delta > 0) delta -= 2 * Math.PI; delta -= 2 * Math.PI * rot[1]; }
    if (rot && rot[0] === "none") delta = 0;
    return a0 + delta * t;
  }
  function tweenMatrix(m0, m1, pivot, t, rot) {
    const A = decompose(m0), B = decompose(m1);
    const P0 = [m0[0] * pivot[0] + m0[2] * pivot[1] + m0[4], m0[1] * pivot[0] + m0[3] * pivot[1] + m0[5]];
    const P1 = [m1[0] * pivot[0] + m1[2] * pivot[1] + m1[4], m1[1] * pivot[0] + m1[3] * pivot[1] + m1[5]];
    const sx = lerp(A.sx, B.sx, t), sy = lerp(A.sy, B.sy, t);
    const ky = angle(A.ky, B.ky, t, rot), kx = angle(A.kx, B.kx, t, rot);
    const a = sx * Math.cos(ky), b = sx * Math.sin(ky), c = -sy * Math.sin(kx), d = sy * Math.cos(kx);
    const px = lerp(P0[0], P1[0], t), py = lerp(P0[1], P1[1], t);
    return [a, b, c, d, px - (a * pivot[0] + c * pivot[1]), py - (b * pivot[0] + d * pivot[1])];
  }

  // ---- paints
  const rgba = (c) => {
    const h = c[0].replace("#", "");
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${c[1]})`;
  };
  const mixColour = (c0, c1, t) => {
    const p = (c, i) => parseInt(c[0].replace("#", "").slice(i, i + 2), 16);
    const hex = [0, 2, 4].map((i) => Math.round(lerp(p(c0, i), p(c1, i), t)).toString(16).padStart(2, "0")).join("");
    return ["#" + hex, lerp(c0[1], c1[1], t)];
  };
  function paint(ctx, style, path, rule, stroke) {
    if (style.t === "solid") {
      if (stroke) { ctx.strokeStyle = rgba(style.c); ctx.stroke(path); } else { ctx.fillStyle = rgba(style.c); ctx.fill(path, rule); }
      return;
    }
    const R = 819.2;
    const g = style.t === "linear" ? ctx.createLinearGradient(-R, 0, R, 0) : ctx.createRadialGradient(style.focal * R, 0, 0, 0, 0, R);
    style.stops.forEach(([ratio, col, alpha]) => g.addColorStop(Math.max(0, Math.min(1, ratio)), rgba([col, alpha])));
    ctx.save();
    if (stroke) { ctx.strokeStyle = rgba(style.stops[0] ? [style.stops[0][1], style.stops[0][2]] : ["#000", 1]); ctx.stroke(path); ctx.restore(); return; }
    ctx.clip(path, rule);
    const m = style.m;
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.fillStyle = g;
    ctx.fillRect(-R * 50, -R * 50, R * 100, R * 100);
    ctx.restore();
  }
  function pathOf(cmds) {
    const p = new Path2D();
    for (const c of cmds) {
      if (c[0] === "M") p.moveTo(c[1], c[2]);
      else if (c[0] === "L") p.lineTo(c[1], c[2]);
      else p.quadraticCurveTo(c[1], c[2], c[3], c[4]);
    }
    return p;
  }
  const CAPS = { none: "butt", round: "round", square: "square" };
  function strokeSetup(ctx, s) {
    ctx.lineWidth = Math.max(s.w, 0.05);
    ctx.lineCap = CAPS[s.caps] || "round";
    ctx.lineJoin = s.joints === "miter" ? "miter" : s.joints === "bevel" ? "bevel" : "round";
    ctx.miterLimit = s.miter || 3;
  }

  // Art brush (Animate Paint Brush): the brush artwork stretched from the stroke's start to its end.
  // Spike: along the straight chord, keeping the artwork's proportions (a curved stroke would bend it).
  const brushImages = {};
  function loadBrushes(brushes) {
    return Promise.all(Object.entries(brushes || {}).map(([id, b]) => new Promise((done) => {
      if (!b.svg) return done();
      const img = new Image();
      img.onload = () => { brushImages[id] = img; done(); };
      img.onerror = () => done();
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(b.svg);
    })));
  }
  function drawBrush(ctx, style, x0, y0, x1, y1) {
    const img = brushImages[style.brush];
    if (!img) return false;
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 0.01) return true;
    const H = L * (img.naturalHeight / img.naturalWidth);
    ctx.save();
    ctx.translate(x0, y0);
    ctx.rotate(Math.atan2(y1 - y0, x1 - x0));
    ctx.drawImage(img, 0, -H / 2, L, H);
    ctx.restore();
    return true;
  }
  const lastPoint = (cmds) => { const c = cmds[cmds.length - 1]; return [c[c.length - 2], c[c.length - 1]]; };

  function drawShape(ctx, el) {
    if (!el._fills) {
      el._fills = el.fills.map((f) => { const p = new Path2D(); f.paths.forEach((c) => p.addPath(pathOf(c))); return p; });
      el._strokes = el.strokes.map((s) => { const p = new Path2D(); s.paths.forEach((c) => p.addPath(pathOf(c))); return p; });
    }
    ctx.save();
    const m = el.m;
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    el.fills.forEach((f, i) => paint(ctx, f.style, el._fills[i], "evenodd"));
    el.strokes.forEach((s, i) => {
      if (s.style.brush && s.paths.every((c) => drawBrush(ctx, s.style, c[0][1], c[0][2], ...lastPoint(c)))) return;
      strokeSetup(ctx, s.style); paint(ctx, s.style.fill, el._strokes[i], null, true);
    });
    ctx.restore();
  }

  // Shape tween: Animate's matched start/end curves (already in timeline space), blended at t.
  // Fill / stroke indices are 0-based into the keyframe's styles (all its drawing objects together).
  const unique = (list) => { const seen = new Map(); list.forEach((s) => { const k = JSON.stringify(s); if (!seen.has(k)) seen.set(k, s); }); return [...seen.values()]; };
  function frameStyles(els) {
    const shapes = els.filter((e) => e.k === "shape");
    const scale = (m) => Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2])) || 1;
    return {
      fills: unique(shapes.flatMap((s) => Object.keys(s.fillStyles).sort((a, b) => a - b).map((k) => s.fillStyles[k]))),
      strokes: unique(shapes.flatMap((s) => Object.keys(s.strokeStyles).sort((a, b) => a - b).map((k) => ({ ...s.strokeStyles[k], w: s.strokeStyles[k].w * scale(s.m) })))),
    };
  }
  function drawMorph(ctx, morph, elsA, elsB, t) {
    const A = elsA._styles || (elsA._styles = frameStyles(elsA));
    const B = elsB._styles || (elsB._styles = frameStyles(elsB));
    const groups = new Map();
    for (const seg of morph) {
      const p = new Path2D();
      const x0 = lerp(seg.a[0], seg.b[0], t), y0 = lerp(seg.a[1], seg.b[1], t);
      let x1 = x0, y1 = y0;
      p.moveTo(x0, y0);
      for (const c of seg.c) {
        x1 = lerp(c[3], c[7], t); y1 = lerp(c[4], c[8], t);
        if (c[0]) p.lineTo(x1, y1);
        else p.quadraticCurveTo(lerp(c[1], c[5], t), lerp(c[2], c[6], t), x1, y1);
      }
      const k = `${seg.f1}|${seg.f2}|${seg.s1}|${seg.s2}`;
      if (!groups.has(k)) groups.set(k, { seg, path: new Path2D(), ends: [] });
      groups.get(k).path.addPath(p);
      groups.get(k).ends.push([x0, y0, x1, y1]);
    }
    for (const { seg, path, ends } of groups.values()) {
      const fa = A.fills[seg.f1], fb = B.fills[seg.f2] || fa;
      if (fa) {
        if (fa.t === "solid" && fb.t === "solid") paint(ctx, { t: "solid", c: mixColour(fa.c, fb.c, t) }, path, "evenodd");
        else paint(ctx, fa, path, "evenodd");
        continue;
      }
      const sa = A.strokes[seg.s1], sb = B.strokes[seg.s2] || sa;
      if (!sa) continue;
      if (sa.brush && ends.every((e) => drawBrush(ctx, sa, ...e))) continue;
      strokeSetup(ctx, { ...sa, w: lerp(sa.w, sb.w, t) });
      paint(ctx, sa.fill.t === "solid" && sb.fill.t === "solid" ? { t: "solid", c: mixColour(sa.fill.c, sb.fill.c, t) } : sa.fill, path, null, true);
    }
  }

  function innerFrame(el, offset, length) {
    if (length <= 1) return 0;
    if (el.st === "graphic") {
      const f = el.first;
      switch (el.loop) {
        case "single frame": return Math.min(f, length - 1);
        case "play once": return Math.min(f + offset, length - 1);
        case "play once reverse": return Math.max(f - offset, 0);
        case "loop reverse": return (((f - offset) % length) + length) % length;
        default: return (f + offset) % length;
      }
    }
    return offset % length; // movie clips run their own timeline
  }

  function Renderer(doc) {
    this.doc = doc;
    this.stats = { shapes: 0, instances: 0, masks: 0, morphs: 0, tweens: 0, missing: new Set() };
  }

  Renderer.prototype.drawElement = function (ctx, el, offset) {
    if (el.k === "shape") { this.stats.shapes++; drawShape(ctx, el); return; }
    if (el.k !== "inst" || el.hidden) return;
    const sym = this.doc.symbols[el.lib];
    if (!sym) { this.stats.missing.add(el.lib); return; }
    this.stats.instances++;
    ctx.save();
    const m = el.m;
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    if (el.alpha != null) ctx.globalAlpha *= el.alpha;
    this.drawTimeline(ctx, sym.tl, innerFrame(el, offset, sym.tl.length));
    ctx.restore();
  };

  Renderer.prototype.drawLayer = function (ctx, layer, frame) {
    const frames = layer.frames;
    const idx = frames.findIndex((f) => frame >= f.i && frame < f.i + f.d);
    if (idx < 0) return;
    const fr = frames[idx], next = frames[idx + 1];
    const offset = frame - fr.i;
    if (fr.tw && next && next.i === fr.i + fr.d && offset > 0) {
      const t = easeFn(fr.ease)(offset / fr.d);
      if (fr.tw === "shape" && fr.morph) {
        this.stats.morphs++;
        drawMorph(ctx, fr.morph, fr.els, next.els, t);
        return;
      }
      if (fr.tw === "motion") {
        this.stats.tweens++;
        fr.els.forEach((el, i) => {
          const end = next.els[i];
          if (el.k === "inst" && end && end.k === "inst") {
            const a0 = el.alpha ?? 1, a1 = end.alpha ?? 1;
            this.drawElement(ctx, { ...el, m: tweenMatrix(el.m, end.m, el.pivot, t, fr.rot), alpha: lerp(a0, a1, t) }, offset);
          } else this.drawElement(ctx, el, offset);
        });
        return;
      }
    }
    fr.els.forEach((el) => this.drawElement(ctx, el, offset));
  };

  Renderer.prototype.drawTimeline = function (ctx, tl, frame) {
    const layers = tl.layers;
    const done = new Set();
    for (let i = layers.length - 1; i >= 0; i--) {
      const layer = layers[i];
      if (done.has(i) || layer.type === "folder" || layer.type === "guide") continue;
      const maskIndex = layer.type === "mask" ? i : layer.parent != null && layers[layer.parent] && layers[layer.parent].type === "mask" ? layer.parent : null;
      if (maskIndex == null) { this.drawLayer(ctx, layer, frame); continue; }
      // Masked group: the content layers, then keep only what the mask layer covers.
      done.add(maskIndex);
      const kids = [];
      for (let j = layers.length - 1; j >= 0; j--) if (layers[j].parent === maskIndex) { kids.push(j); done.add(j); }
      this.stats.masks++;
      const { width, height } = ctx.canvas;
      const content = new OffscreenCanvas(width, height), mask = new OffscreenCanvas(width, height);
      const cc = content.getContext("2d"), mc = mask.getContext("2d");
      cc.setTransform(ctx.getTransform()); mc.setTransform(ctx.getTransform());
      cc.globalAlpha = ctx.globalAlpha;
      kids.forEach((j) => this.drawLayer(cc, layers[j], frame));
      this.drawLayer(mc, layers[maskIndex], frame);
      cc.setTransform(1, 0, 0, 1, 0, 0);
      cc.globalAlpha = 1;
      cc.globalCompositeOperation = "destination-in";
      cc.drawImage(mask, 0, 0);
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.drawImage(content, 0, 0);
      ctx.restore();
    }
  };

  window.FlaRenderer = Renderer;
  window.loadBrushes = loadBrushes;
})();
