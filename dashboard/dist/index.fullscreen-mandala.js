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

  function graphLayout(graph) {
    const nodes = graph.nodes || [];
    const links = graph.connections || [];
    const hubs = graph.hubs || [];
    const cx = 500, cy = 500;
    const byId = Object.fromEntries(nodes.map((n) => [n.id, n]));
    const termRank = Object.fromEntries(hubs.map((h, i) => [h.term, i]));
    const pos = {};
    const total = Math.max(1, nodes.length);
    nodes.forEach((node, i) => {
      const dominant = (node.terms || []).find((t) => termRank[t] !== undefined);
      const hubShift = dominant ? termRank[dominant] * 0.22 : 0;
      const angle = -Math.PI / 2 + (Math.PI * 2 * i / total) + hubShift + ((node.weight || 1) * 0.009);
      const kindRing = node.kind === "identity" ? 145 : node.kind === "safety" ? 235 : node.kind === "skills" ? 370 : node.kind === "recent" ? 315 : 260;
      const r = kindRing + ((node.terms || []).length % 4) * 18;
      const [x, y] = polar(cx, cy, r, angle);
      pos[node.id] = { x, y, angle, r, node };
    });
    return { nodes, links, hubs, pos, byId, cx, cy };
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
    const active = pinned || hover;
    const activeTerms = termFocus ? [termFocus] : (active ? terms(active.data) : []);
    const activeHas = (node) => activeTerms && activeTerms.some((t) => (node.terms || []).includes(t));

    const openTerm = (term) => {
      const related = (graph.nodes || []).filter((n) => (n.terms || []).includes(term));
      setTermFocus(term);
      setPinned({
        type: "term hub",
        data: { title: term, text: related.map((n) => n.text).join(" | "), meta: `${related.length} memory facts`, terms: [term] },
        x: window.innerWidth - 500,
        y: 120
      });
    };

    const nodeItem = (node, evt) => ({
      type: "memory fact",
      data: { ...node, title: node.source, meta: (node.terms || []).join(", ") },
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
      e("svg", { className: "mm-psy-svg", viewBox: "0 0 1000 1000", role: "img", "aria-label": "fullscreen geometric mandala of evidence-backed memory connections" },
        e("defs", null,
          e("radialGradient", { id: "mmPsyBg", cx: "50%", cy: "50%" },
            e("stop", { offset: "0%", stopColor: "var(--mm-primary)", stopOpacity: ".22" }),
            e("stop", { offset: "58%", stopColor: "var(--mm-bg)", stopOpacity: ".72" }),
            e("stop", { offset: "100%", stopColor: "var(--mm-bg)", stopOpacity: "1" })
          ),
          e("filter", { id: "mmGlow" }, e("feGaussianBlur", { stdDeviation: "4", result: "b" }), e("feMerge", null, e("feMergeNode", { in: "b" }), e("feMergeNode", { in: "SourceGraphic" })))
        ),
        e("rect", { width: 1000, height: 1000, fill: "url(#mmPsyBg)" }),
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
      e("div", { className: "mm-corner mm-bottom-left" },
        keyTerms(structure.summary.strongest_terms, 8).map((t) => e("button", { key: t, onClick: () => openTerm(t) }, t))
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
