(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__ || {};
  const React = SDK.React;
  const hooks = SDK.hooks || React;
  const fetchJSON = SDK.fetchJSON || ((url, opts) => fetch(url, opts).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }));
  const e = React.createElement;
  const API = "/api/plugins/memory-mandala";

  const KIND = {
    identity: { label: "identity", short: "id", color: "--mm-identity" },
    preferences: { label: "preferences", short: "pref", color: "--mm-preferences" },
    projects: { label: "projects", short: "proj", color: "--mm-projects" },
    skills: { label: "skills", short: "skill", color: "--mm-skills" },
    safety: { label: "safety", short: "safe", color: "--mm-safety" },
    recent: { label: "recent", short: "new", color: "--mm-recent" }
  };

  function color(kind) { return `var(${(KIND[kind] || KIND.projects).color})`; }
  function short(text, max) { return text && text.length > max ? text.slice(0, max - 1) + "…" : (text || ""); }
  function terms(item) { return item && (item.shared_terms || item.terms || []); }
  function keyTerms(list, n) { return (list || []).filter(Boolean).slice(0, n); }
  function polar(cx, cy, r, angle) { return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r]; }
  function annularPath(cx, cy, r0, r1, a0, a1) {
    const p0 = polar(cx, cy, r1, a0), p1 = polar(cx, cy, r1, a1), p2 = polar(cx, cy, r0, a1), p3 = polar(cx, cy, r0, a0);
    const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
    return `M ${p0[0]} ${p0[1]} A ${r1} ${r1} 0 ${large} 1 ${p1[0]} ${p1[1]} L ${p2[0]} ${p2[1]} A ${r0} ${r0} 0 ${large} 0 ${p3[0]} ${p3[1]} Z`;
  }
  const KINDS = ["identity", "preferences", "projects", "skills", "safety", "recent"];
  function kindIndex(kind) { return Math.max(0, KINDS.indexOf(kind)); }
  function sectorMid(kind) { return -Math.PI / 2 + (Math.PI * 2 * (kindIndex(kind) + .5) / KINDS.length); }
  function sectorStart(kind) { return -Math.PI / 2 + (Math.PI * 2 * kindIndex(kind) / KINDS.length); }

  function graphLayout(graph) {
    const nodes = graph.nodes || [];
    const links = graph.connections || [];
    const hubs = graph.hubs || [];
    const cx = 500, cy = 500;
    const byKind = Object.fromEntries(KINDS.map((k) => [k, []]));
    nodes.forEach((n) => (byKind[n.kind] || byKind.projects).push(n));
    const pos = {};
    KINDS.forEach((kind) => {
      const group = byKind[kind] || [];
      const start = sectorStart(kind) + 0.11;
      const span = (Math.PI * 2 / KINDS.length) - 0.22;
      group.forEach((node, i) => {
        const t = (i + .5) / Math.max(1, group.length);
        const angle = start + span * t;
        const termDepth = Math.min(5, (node.terms || []).length);
        const usage = node.kind === "skills" ? Math.min(1, (node.usage_heat || 0)) * 42 : 0;
        const r = 168 + termDepth * 28 + (i % 3) * 42 + usage;
        const [x, y] = polar(cx, cy, r, angle);
        pos[node.id] = { x, y, angle, r, node };
      });
    });
    return { nodes, links, hubs, pos, byKind, cx, cy };
  }

  const HUES = { identity: 265, preferences: 324, projects: 190, skills: 45, safety: 350, recent: 158 };
  function hsla(h, s, l, a) { return `hsla(${h}, ${s}%, ${l}%, ${a})`; }
  function drawPetal(ctx, cx, cy, angle, inner, outer, width, fill, stroke) {
    const mid = (inner + outer) / 2;
    const len = outer - inner;
    const x = cx + Math.cos(angle) * mid;
    const y = cy + Math.sin(angle) * mid;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, -len / 2);
    ctx.bezierCurveTo(width, -len * .26, width, len * .26, 0, len / 2);
    ctx.bezierCurveTo(-width, len * .26, -width, -len * .26, 0, -len / 2);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1.2;
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
  function drawP5Mandala(canvas, layout, activeTerms, summary) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(rect.width * dpr));
    const h = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    const ctx = canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, rect.width, rect.height);
    const size = Math.min(rect.width, rect.height) * .9;
    const cx = rect.width / 2;
    const cy = rect.height / 2 + 12;
    const S = size / 1000;
    const toX = (x) => cx + (x - 500) * S;
    const toY = (y) => cy + (y - 500) * S;
    const toR = (r) => r * S;

    const bg = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * .62);
    bg.addColorStop(0, "rgba(164, 92, 246, .24)");
    bg.addColorStop(.42, "rgba(7, 10, 22, .58)");
    bg.addColorStop(1, "rgba(2, 3, 9, .96)");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, rect.width, rect.height);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.globalCompositeOperation = "screen";
    for (let i = 0; i < 72; i++) {
      const a = Math.PI * 2 * i / 72 - Math.PI / 2;
      const hue = 35 + (i % 6) * 48;
      drawPetal(ctx, 0, 0, a, toR(82), toR(452 + ((i % 3) * 12)), toR(13 + (i % 5)), hsla(hue, 95, 58, .045), hsla(hue, 100, 68, .18));
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();

    KINDS.forEach((kind, ki) => {
      const count = (layout.byKind[kind] || []).length;
      const start = -Math.PI / 2 + Math.PI * 2 * ki / KINDS.length;
      const end = start + Math.PI * 2 / KINDS.length;
      const hue = HUES[kind] || 200;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, toR(468), start + .018, end - .018);
      ctx.closePath();
      ctx.fillStyle = hsla(hue, 96, 58, .075 + Math.min(.08, count / 140));
      ctx.strokeStyle = hsla(hue, 100, 70, .58);
      ctx.lineWidth = 1.4;
      ctx.fill();
      ctx.stroke();

      const petalCount = Math.max(2, Math.min(18, count));
      for (let j = 0; j < petalCount; j++) {
        const a = start + (end - start) * ((j + .5) / petalCount);
        const inner = toR(135 + (j % 4) * 34);
        const outer = toR(250 + (j % 5) * 38 + count * 2.2);
        drawPetal(ctx, cx, cy, a, inner, outer, toR(11 + (count % 7)), hsla(hue, 98, 58, .22), hsla(hue, 100, 72, .65));
      }
    });

    for (let r = 74; r <= 462; r += 28) {
      ctx.beginPath();
      ctx.arc(cx, cy, toR(r), 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255,255,255,${r % 56 === 0 ? .19 : .07})`;
      ctx.lineWidth = r % 84 === 0 ? 1.6 : .75;
      if (r % 56 === 0) ctx.setLineDash([toR(5), toR(10)]); else ctx.setLineDash([]);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    layout.links.forEach((conn) => {
      const a = layout.pos[conn.from], b = layout.pos[conn.to];
      if (!a || !b) return;
      const alive = !activeTerms.length || conn.shared_terms.some((t) => activeTerms.includes(t));
      const hue = HUES[conn.from_kind] || 280;
      ctx.beginPath();
      ctx.moveTo(toX(a.x), toY(a.y));
      ctx.quadraticCurveTo(cx, cy, toX(b.x), toY(b.y));
      ctx.strokeStyle = hsla(hue, 100, alive ? 70 : 42, alive ? .55 : .08);
      ctx.lineWidth = alive ? Math.min(5, 1 + conn.weight * .7) : .9;
      ctx.stroke();
    });

    layout.nodes.forEach((node) => {
      const p = layout.pos[node.id];
      if (!p) return;
      const hue = HUES[node.kind] || 210;
      const alive = !activeTerms.length || (node.terms || []).some((t) => activeTerms.includes(t));
      const x = toX(p.x), y = toY(p.y);
      const rad = toR(6 + Math.min(18, (node.weight || 1) * 1.8));
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(p.angle);
      ctx.globalAlpha = alive ? 1 : .18;
      const petals = Math.max(4, Math.min(10, (node.terms || []).length + 2));
      for (let j = 0; j < petals; j++) {
        const a = Math.PI * 2 * j / petals;
        drawPetal(ctx, 0, 0, a, rad * .8, rad * 2.8, rad * .45, hsla(hue + j * 6, 100, 62, .55), hsla(hue, 100, 78, .86));
      }
      ctx.beginPath();
      ctx.arc(0, 0, rad, 0, Math.PI * 2);
      ctx.fillStyle = hsla(hue, 100, 58, .92);
      ctx.strokeStyle = "rgba(255,255,255,.82)";
      ctx.lineWidth = 1.2;
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    });

    ctx.save();
    ctx.translate(cx, cy);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.beginPath();
      ctx.moveTo(0, -toR(42));
      ctx.lineTo(toR(18), -toR(74));
      ctx.lineTo(0, -toR(105));
      ctx.lineTo(-toR(18), -toR(74));
      ctx.closePath();
      ctx.fillStyle = i % 2 ? "rgba(255, 213, 79, .16)" : "rgba(0, 255, 230, .12)";
      ctx.strokeStyle = "rgba(255,255,255,.42)";
      ctx.stroke();
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, 0, toR(54), 0, Math.PI * 2);
    ctx.fillStyle = "rgba(5, 5, 10, .78)";
    ctx.strokeStyle = "rgba(255,255,255,.64)";
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "rgba(255,255,255,.92)";
    ctx.font = `${Math.max(14, toR(27))}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.fillText(String(summary.connection_count || 0), 0, -toR(2));
    ctx.font = `${Math.max(9, toR(11))}px ui-monospace, monospace`;
    ctx.fillStyle = "rgba(255,255,255,.58)";
    ctx.fillText("strong links", 0, toR(21));
    ctx.restore();
  }

  function Overlay({ item, pinned, graph, onPin, onClose, onOpenTerm }) {
    if (!item) return null;
    const data = item.data || item;
    const itemTerms = keyTerms(terms(data), 10);
    const evidence = data.evidence || [];
    const related = itemTerms.length ? (graph.nodes || []).filter((n) => n.id !== data.id && (n.terms || []).some((t) => itemTerms.includes(t))).slice(0, 5) : [];
    const style = pinned ? { right: 24, top: 86 } : { left: Math.min((item.x || 24) + 18, window.innerWidth - 460), top: Math.max(78, Math.min((item.y || 120) + 14, window.innerHeight - 330)) };
    return e("div", { className: `mm-float ${pinned ? "pinned" : "hover"}`, style, onMouseEnter: () => onPin && pinned && onPin(item) },
      e("div", { className: "mm-float-head" },
        e("div", null,
          e("p", null, item.type || data.kind || "memory"),
          e("h2", null, data.title || data.source || data.from_label || "memory fact")
        ),
        pinned && e("button", { onClick: onClose, title: "close" }, "×")
      ),
      data.meta && e("code", { className: "mm-meta" }, data.meta),
      data.text && e("p", { className: "mm-maintext" }, data.text),
      data.source_path && e("code", { className: "mm-meta" }, data.source_path),
      itemTerms.length ? e("div", { className: "mm-term-row" }, itemTerms.map((t) => e("button", { key: t, onClick: () => onOpenTerm(t) }, t))) : null,
      evidence.length ? e("div", { className: "mm-evidence-pair" }, evidence.map((ev, i) => e("button", { key: i, onClick: () => onPin({ type: "evidence", data: { title: `evidence ${i + 1}`, text: ev, meta: data.meta }, x: item.x, y: item.y }) }, ev))) : null,
      related.length ? e("div", { className: "mm-related" },
        e("p", null, "connected facts"),
        related.map((n) => e("button", { key: n.id, onClick: () => onPin({ type: "memory fact", data: { ...n, title: n.source, meta: (n.terms || []).join(", ") }, x: item.x, y: item.y }) }, short(n.text, 86)))
      ) : null
    );
  }

  function FullscreenMandala({ structure, save, saving, state }) {
    const graph = (structure && structure.memory_graph) || { nodes: [], connections: [], hubs: [] };
    const layout = graphLayout(graph);
    const [hover, setHover] = hooks.useState(null);
    const [pinned, setPinned] = hooks.useState(null);
    const [termFocus, setTermFocus] = hooks.useState(null);
    const canvasRef = hooks.useRef(null);
    const active = pinned || hover;
    const activeTerms = termFocus ? [termFocus] : (active ? terms(active.data) : []);
    const activeHas = (node) => activeTerms && activeTerms.some((t) => (node.terms || []).includes(t));

    hooks.useEffect(() => {
      const draw = () => drawP5Mandala(canvasRef.current, layout, activeTerms, structure.summary || {});
      draw();
      window.addEventListener("resize", draw);
      return () => window.removeEventListener("resize", draw);
    }, [structure, termFocus, hover && hover.data && hover.data.id, pinned && pinned.data && pinned.data.id]);

    const openTerm = (term) => {
      const related = (graph.nodes || []).filter((n) => (n.terms || []).includes(term));
      setTermFocus(term);
      setPinned({
        type: "term hub",
        data: { title: term, text: `${term} is shared by ${related.length} memory facts.`, meta: `${related.length} memory facts`, terms: [term], evidence: related.map((n) => n.text) },
        x: window.innerWidth - 500,
        y: 120
      });
    };

    const nodeItem = (node, evt) => ({
      type: "memory fact",
      data: { ...node, title: node.source, meta: (node.terms || []).join(", "), source_path: node.source_path },
      x: evt.clientX,
      y: evt.clientY
    });
    const connItem = (conn, evt) => ({
      type: "connection",
      data: { ...conn, title: conn.shared_terms.join(" + "), text: `${conn.from_label} ↔ ${conn.to_label}`, meta: conn.reason },
      x: evt.clientX,
      y: evt.clientY
    });
    const hubItem = (hub, evt) => ({
      type: "hub",
      data: { title: hub.term, text: (graph.nodes || []).filter((n) => (n.terms || []).includes(hub.term)).map((n) => n.text).join(" | "), meta: `${hub.count} memory facts`, terms: [hub.term] },
      x: evt.clientX,
      y: evt.clientY
    });

    return e("div", { className: "mm-fullscreen", onMouseLeave: () => setHover(null) },
      e("div", { className: "mm-corner mm-top-left" },
        e("p", null, "memory mandala"),
        e("h1", null, structure.summary.connection_count || 0, " evidence links"),
        e("span", null, `${structure.summary.fact_count || 0} facts · ${structure.summary.source_count || 0} sources · ${structure.summary.total_skills || 0} skills`)
      ),
      e("div", { className: "mm-corner mm-top-right" },
        state && state.has_unbloomed_changes && e("span", { className: "mm-live" }, "memory changed"),
        e("button", { onClick: () => save(false), disabled: saving }, saving ? "saving" : "snapshot"),
        e("button", { onClick: () => save(true), disabled: saving }, "force")
      ),
      e("canvas", { ref: canvasRef, className: "mm-p5-canvas", "aria-hidden": "true" }),
      e("svg", { className: "mm-psy-svg", viewBox: "0 0 1000 1000", role: "img", "aria-label": "fullscreen geometric mandala of evidence-backed memory connections" },
        e("defs", null,
          e("radialGradient", { id: "mmPsyBg", cx: "50%", cy: "50%" },
            e("stop", { offset: "0%", stopColor: "var(--mm-primary)", stopOpacity: ".22" }),
            e("stop", { offset: "58%", stopColor: "var(--mm-bg)", stopOpacity: ".72" }),
            e("stop", { offset: "100%", stopColor: "var(--mm-bg)", stopOpacity: "1" })
          ),
          e("filter", { id: "mmGlow" }, e("feGaussianBlur", { stdDeviation: "4", result: "b" }), e("feMerge", null, e("feMergeNode", { in: "b" }), e("feMergeNode", { in: "SourceGraphic" })))
        ),
        e("rect", { width: 1000, height: 1000, fill: "transparent" }),
        KINDS.map((kind) => {
          const a0 = sectorStart(kind) + 0.018;
          const a1 = sectorStart(kind) + Math.PI * 2 / KINDS.length - 0.018;
          const count = (layout.byKind[kind] || []).length;
          return e("g", { key: `sector-${kind}`, className: `mm-sector ${kind}`, onMouseMove: (evt) => setHover({ type: "sector", data: { title: KIND[kind].label, text: `${count} real memory facts in this sector.`, meta: kind, terms: [] }, x: evt.clientX, y: evt.clientY }), onClick: (evt) => setPinned({ type: "sector", data: { title: KIND[kind].label, text: `${count} real memory facts in this sector.`, meta: kind, terms: [] }, x: evt.clientX, y: evt.clientY }) },
            e("path", { d: annularPath(layout.cx, layout.cy, 112, 455, a0, a1), style: { fill: color(kind), stroke: color(kind) } }),
            e("text", { x: polar(layout.cx, layout.cy, 468, sectorMid(kind))[0], y: polar(layout.cx, layout.cy, 468, sectorMid(kind))[1], textAnchor: "middle" }, `${KIND[kind].label} · ${count}`)
          );
        }),
        KINDS.flatMap((kind) => Array.from({ length: Math.max(2, Math.min(10, (layout.byKind[kind] || []).length || 0)) }, (_, j) => {
          const total = Math.max(2, Math.min(10, (layout.byKind[kind] || []).length || 0));
          const a = sectorStart(kind) + (Math.PI * 2 / KINDS.length) * ((j + .5) / total);
          const inner = polar(layout.cx, layout.cy, 118 + j * 21, a);
          return e("ellipse", { key: `petal-${kind}-${j}`, className: `mm-data-petal ${kind}`, cx: inner[0], cy: inner[1], rx: 9 + j * .9, ry: 38 + j * 2.7, transform: `rotate(${a * 180 / Math.PI} ${inner[0]} ${inner[1]})`, style: { fill: color(kind), stroke: color(kind) } });
        })),
        [110, 170, 230, 290, 350, 410].map((r, i) => e("polygon", {
          key: `poly-${r}`,
          className: "mm-sacred-poly",
          points: Array.from({ length: 6 + i * 2 }, (_, j) => {
            const a = -Math.PI / 2 + Math.PI * 2 * j / (6 + i * 2) + i * .12;
            const p = polar(layout.cx, layout.cy, r, a);
            return `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
          }).join(" ")
        })),
        layout.hubs.slice(0, 8).map((hub, i) => {
          const r = 78 + i * 44;
          return e("g", { key: `hub-${hub.term}`, className: "mm-hub-orbit", onMouseMove: (evt) => setHover(hubItem(hub, evt)), onClick: (evt) => setPinned(hubItem(hub, evt)) },
            e("circle", { cx: layout.cx, cy: layout.cy, r, style: { stroke: color(["identity", "preferences", "projects", "skills", "safety", "recent"][i % 6]) } }),
            e("text", { x: layout.cx, y: layout.cy - r - 8, textAnchor: "middle" }, hub.term)
          );
        }),
        layout.links.map((conn) => {
          const a = layout.pos[conn.from], b = layout.pos[conn.to];
          if (!a || !b) return null;
          const alive = !activeTerms.length || conn.shared_terms.some((t) => activeTerms.includes(t));
          return e("g", { key: conn.id, className: `mm-link ${alive ? "alive" : "dim"}`, onMouseMove: (evt) => setHover(connItem(conn, evt)), onClick: (evt) => setPinned(connItem(conn, evt)) },
            e("path", { d: `M ${a.x} ${a.y} Q ${layout.cx} ${layout.cy} ${b.x} ${b.y}`, strokeWidth: Math.min(7, 1 + conn.weight * .9) }),
            e("circle", { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: 2 + Math.min(5, conn.shared_terms.length) })
          );
        }),
        layout.nodes.map((node, i) => {
          const p = layout.pos[node.id];
          const alive = !activeTerms.length || activeHas(node);
          const size = 9 + Math.min(22, (node.weight || 1) * 2);
          const petals = Math.max(3, Math.min(9, (node.terms || []).length));
          return e("g", { key: node.id, className: `mm-memory-glyph ${node.kind} ${alive ? "alive" : "dim"}`, onMouseMove: (evt) => setHover(nodeItem(node, evt)), onClick: (evt) => setPinned(nodeItem(node, evt)), tabIndex: 0, role: "button", "aria-label": `${node.source}: ${node.text}` },
            Array.from({ length: petals }, (_, j) => {
              const a = p.angle + Math.PI * 2 * j / petals;
              const q = polar(p.x, p.y, size * 1.7, a);
              return e("ellipse", { key: j, cx: q[0], cy: q[1], rx: size * .42, ry: size * 1.18, transform: `rotate(${a * 180 / Math.PI} ${q[0]} ${q[1]})`, style: { fill: color(node.kind) } });
            }),
            e("circle", { cx: p.x, cy: p.y, r: size, style: { fill: color(node.kind) } }),
            e("text", { x: p.x, y: p.y + 4, textAnchor: "middle" }, KIND[node.kind]?.short || "mem")
          );
        }),
        e("g", { className: "mm-center-sigil", onMouseMove: (evt) => setHover({ type: "overview", data: { title: "evidence-only graph", text: `${structure.summary.fact_count || 0} facts with ${structure.summary.connection_count || 0} strong links. Weak one-term links are hidden.`, meta: (structure.summary.strongest_terms || []).join(", ") }, x: evt.clientX, y: evt.clientY }), onClick: (evt) => setPinned({ type: "overview", data: { title: "evidence-only graph", text: `${structure.summary.fact_count || 0} facts with ${structure.summary.connection_count || 0} strong links. Weak one-term links are hidden.`, meta: (structure.summary.strongest_terms || []).join(", ") }, x: evt.clientX, y: evt.clientY }) },
          e("circle", { cx: layout.cx, cy: layout.cy, r: 64 }),
          e("circle", { cx: layout.cx, cy: layout.cy, r: 42 }),
          e("text", { x: layout.cx, y: layout.cy - 2, textAnchor: "middle" }, structure.summary.connection_count || 0),
          e("text", { x: layout.cx, y: layout.cy + 18, textAnchor: "middle" }, "links")
        )
      ),
      graph.nodes && graph.nodes.length ? null : e("div", { className: "mm-empty" }, "no strong memory graph yet"),
      e(Overlay, { item: hover && !pinned ? hover : null, graph, onOpenTerm: openTerm }),
      e(Overlay, { item: pinned, pinned: true, graph, onPin: setPinned, onClose: () => { setPinned(null); setTermFocus(null); }, onOpenTerm: openTerm })
    );
  }

  function MemoryMandalaPage() {
    const [state, setState] = hooks.useState(null);
    const [current, setCurrent] = hooks.useState(null);
    const [loading, setLoading] = hooks.useState(true);
    const [error, setError] = hooks.useState(null);
    const [saving, setSaving] = hooks.useState(false);

    const load = hooks.useCallback(async () => {
      try {
        setError(null);
        const s = await fetchJSON(`${API}/state`);
        setState(s); setCurrent(s.genome); setLoading(false);
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); setLoading(false); }
    }, []);
    hooks.useEffect(() => { load(); }, [load]);

    const save = async (force) => {
      setSaving(true);
      try {
        const snap = await fetchJSON(`${API}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: !!force }) });
        setCurrent(snap); await load();
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      finally { setSaving(false); }
    };

    if (loading) return e("div", { className: "mm-page mm-loading" }, "loading mandala…");
    if (error) return e("div", { className: "mm-page mm-loading" }, e("p", null, error), e("button", { onClick: load }, "retry"));
    const active = current || (state && state.genome) || {};
    const structure = active.structure || { summary: {}, memory_graph: { nodes: [], connections: [], hubs: [] } };
    return e("div", { className: "mm-page" }, e(FullscreenMandala, { structure, save, saving, state }));
  }

  function MemoryMandalaBadge() {
    const [state, setState] = hooks.useState(null);
    hooks.useEffect(() => { fetchJSON(`${API}/state`).then(setState).catch(() => {}); }, []);
    const links = state && state.genome && state.genome.structure ? state.genome.structure.summary.connection_count : null;
    return e("a", { className: "mm-header-badge", href: "#/memory-mandala", title: "Memory Mandala" }, e("span", null), links === null ? "memory mandala" : `${links} strong links`);
  }

  window.__HERMES_PLUGINS__.register("memory-mandala", MemoryMandalaPage);
  if (window.__HERMES_PLUGINS__.registerSlot) {
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "header-right", MemoryMandalaBadge);
  }
})();
