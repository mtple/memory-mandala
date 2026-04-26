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

  const KINDS = ["identity", "preferences", "projects", "skills", "safety", "recent"];
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
  function polar(cx, cy, r, a) { return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }
  function sectorStart(kind) { return -Math.PI / 2 + Math.PI * 2 * Math.max(0, KINDS.indexOf(kind)) / KINDS.length; }
  function sectorMid(kind) { return sectorStart(kind) + Math.PI / KINDS.length; }
  function sourceLabel(node) {
    const raw = (node && (node.text || node.title || node.source) || "memory").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
    if (/session[:_ -]*session[_-]?\d/i.test(raw) || /session[:_ -]*session[_-]?\d/i.test(String(node && node.source || ""))) return "recent session memory";
    return short(raw.replace(/^(what works on farcaster \([^)]*\):\s*)/i, ""), 96);
  }
  function importance(node) {
    return (node.weight || 1) + ((node.terms || []).length * .4) + (node.kind === "skills" ? (node.usage_heat || 0) * 4 : 0);
  }
  function layoutGraph(graph) {
    const nodes = graph.nodes || [];
    const byKind = Object.fromEntries(KINDS.map((k) => [k, []]));
    nodes.forEach((n) => (byKind[n.kind] || byKind.projects).push(n));
    const pos = {};
    KINDS.forEach((kind) => {
      const group = (byKind[kind] || []).slice().sort((a, b) => importance(b) - importance(a));
      const start = sectorStart(kind) + .12;
      const span = Math.PI * 2 / KINDS.length - .24;
      group.forEach((node, i) => {
        const t = (i + .5) / Math.max(1, group.length);
        const a = start + span * t;
        const lane = [190, 250, 310, 370][i % 4];
        const r = lane + Math.max(0, 22 - i * 1.5);
        const [x, y] = polar(500, 500, r, a);
        pos[node.id] = { x, y, a, r, node, priority: i < 2 };
      });
    });
    return { nodes, links: graph.connections || [], hubs: graph.hubs || [], byKind, pos };
  }
  function matches(node, query, kind, term) {
    if (kind && node.kind !== kind) return false;
    if (term && !(node.terms || []).includes(term)) return false;
    const q = (query || "").trim().toLowerCase();
    if (!q) return true;
    return [node.kind, node.source, node.text, ...(node.terms || [])].join(" ").toLowerCase().includes(q);
  }
  function rankedTerms(nodes, limit) {
    const counts = new Map();
    (nodes || []).forEach((n) => (n.terms || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([term, count]) => ({ term, count }));
  }
  function detailFromNode(node) {
    return { type: "memory fact", kind: node.kind, title: sourceLabel(node), text: node.text, terms: node.terms || [], evidence: node.evidence || [], id: node.id };
  }
  function detailFromConnection(conn) {
    return { type: "connection", title: conn.shared_terms.join(" + "), text: `${conn.from_label} ↔ ${conn.to_label}`, terms: conn.shared_terms || [], evidence: conn.evidence || [] };
  }
  function detailFromSector(kind, layout) {
    const nodes = layout.byKind[kind] || [];
    const terms = rankedTerms(nodes, 10).map((x) => x.term);
    return { type: "sector", kind, title: KIND[kind].label, text: `${nodes.length} source-backed memories in this sector.`, terms, evidence: nodes.slice(0, 6).map((n) => n.text) };
  }

  function UnifiedInspector({ graph, layout, selected, setSelected, query, setQuery, kind, setKind, term, setTerm, reset, save, saving, state }) {
    const visible = (graph.nodes || []).filter((n) => matches(n, query, kind, term)).sort((a, b) => importance(b) - importance(a));
    const detail = selected || (visible[0] ? detailFromNode(visible[0]) : { type: "overview", title: "overview", text: "inspect one memory at a time. search, choose a sector, or move around the mandala to see source-backed evidence here.", terms: rankedTerms(graph.nodes || [], 10).map((x) => x.term), evidence: visible.slice(0, 6).map((n) => n.text) });
    const terms = (detail.terms || []).slice(0, 10);
    const nearby = detail.id ? (graph.connections || []).filter((c) => c.from === detail.id || c.to === detail.id).slice(0, 4) : [];
    return e("aside", { className: "mm-left-pane", "aria-label": "memory inspector" },
      e("header", { className: "mm-pane-intro" },
        e("p", null, "memory mandala"),
        e("h1", null, "memory graph"),
        e("span", null, "inspect one memory at a time")
      ),
      e("section", { className: "mm-controls" },
        e("label", { className: "mm-search" },
          e("span", null, "search"),
          e("input", { value: query, placeholder: "filter memory…", onChange: (evt) => setQuery(evt.target.value) })
        ),
        e("div", { className: "mm-kind-row" },
          e("button", { className: !kind ? "active" : "", onClick: () => setKind(null) }, "all"),
          KINDS.map((k) => e("button", { key: k, className: `${k} ${kind === k ? "active" : ""}`, onClick: () => { setKind(k); setSelected(detailFromSector(k, layout)); } }, KIND[k].label))
        ),
        (query || kind || term) ? e("button", { className: "mm-reset", onClick: reset }, "reset view") : null
      ),
      e("article", { className: `mm-detail ${detail.kind || "overview"}` },
        e("div", { className: "mm-detail-kicker" }, detail.type || "memory"),
        e("h2", null, short(detail.title, 90)),
        e("p", { className: "mm-detail-text" }, detail.text),
        terms.length ? e("div", { className: "mm-term-row", "aria-label": "filter terms" }, terms.map((t) => e("button", { key: t, onClick: () => setTerm(t) }, t))) : null,
        e("section", { className: "mm-evidence" },
          e("h3", null, "primary evidence"),
          (detail.evidence && detail.evidence.length ? detail.evidence : visible.slice(0, 5).map((n) => n.text)).slice(0, 7).map((ev, i) => e("p", { key: i }, ev))
        ),
        nearby.length ? e("section", { className: "mm-nearby" },
          e("h3", null, "nearby connections"),
          nearby.map((conn) => e("button", { key: conn.id, onClick: () => setSelected(detailFromConnection(conn)) }, e("strong", null, conn.shared_terms.join(" + ")), e("span", null, `${short(conn.from_label, 44)} ↔ ${short(conn.to_label, 44)}`)))
        ) : null
      ),
      e("section", { className: "mm-results" },
        e("div", { className: "mm-results-head" }, e("h3", null, query || kind || term ? "matching memories" : "useful memories"), e("span", null, `${visible.length}`)),
        visible.slice(0, 6).map((node) => e("button", { key: node.id, className: `mm-result ${node.kind}`, onClick: () => setSelected(detailFromNode(node)) }, e("b", null, KIND[node.kind]?.short || node.kind), e("span", null, sourceLabel(node)), e("small", null, short(node.text, 150))))
      ),
      e("footer", { className: "mm-admin" }, state && state.has_unbloomed_changes ? e("span", null, "memory changed") : e("span", null, "map current"), e("button", { onClick: () => save(true), disabled: saving }, saving ? "rebuilding…" : "rebuild map"))
    );
  }

  function Mandala({ graph, layout, visibleIds, selected, setSelected, setKind, setTerm }) {
    return e("section", { className: "mm-map", "aria-label": "memory mandala" },
      e("svg", { viewBox: "0 0 1000 1000", role: "img" },
        e("defs", null, e("filter", { id: "mmGlow" }, e("feGaussianBlur", { stdDeviation: "4", result: "b" }), e("feMerge", null, e("feMergeNode", { in: "b" }), e("feMergeNode", { in: "SourceGraphic" })))),
        e("circle", { className: "mm-guide", cx: 500, cy: 500, r: 420 }),
        e("circle", { className: "mm-guide", cx: 500, cy: 500, r: 300 }),
        e("circle", { className: "mm-guide", cx: 500, cy: 500, r: 180 }),
        KINDS.map((kind) => {
          const a = sectorMid(kind); const [x, y] = polar(500, 500, 455, a);
          return e("g", { key: kind, className: `mm-sector ${kind}`, onMouseMove: () => setSelected(detailFromSector(kind, layout)), onClick: () => { setKind(kind); setSelected(detailFromSector(kind, layout)); } },
            e("path", { d: `M500 500 L${polar(500,500,120,sectorStart(kind))[0]} ${polar(500,500,120,sectorStart(kind))[1]} A120 120 0 0 1 ${polar(500,500,120,sectorStart(kind)+Math.PI*2/KINDS.length)[0]} ${polar(500,500,120,sectorStart(kind)+Math.PI*2/KINDS.length)[1]} Z`, style: { fill: color(kind) } }),
            e("text", { x, y, textAnchor: "middle" }, KIND[kind].label)
          );
        }),
        (graph.connections || []).slice(0, 80).map((conn) => {
          const a = layout.pos[conn.from], b = layout.pos[conn.to];
          if (!a || !b) return null;
          const live = visibleIds.has(conn.from) && visibleIds.has(conn.to);
          return e("path", { key: conn.id, className: `mm-edge ${live ? "live" : "dim"}`, d: `M${a.x} ${a.y} Q500 500 ${b.x} ${b.y}`, onMouseMove: () => setSelected(detailFromConnection(conn)), onClick: () => setSelected(detailFromConnection(conn)) });
        }),
        (graph.hubs || []).slice(0, 10).map((hub, i) => {
          const a = -Math.PI/2 + i * Math.PI * 2 / Math.max(1, Math.min(10, (graph.hubs || []).length)); const [x, y] = polar(500, 500, 115, a);
          return e("g", { key: hub.term, className: "mm-hub", onMouseMove: () => setSelected({ type: "term", title: hub.term, text: "shared term hub", terms: [hub.term], evidence: (graph.nodes || []).filter((n) => (n.terms || []).includes(hub.term)).slice(0, 6).map((n) => n.text) }), onClick: () => setTerm(hub.term) }, e("circle", { cx: x, cy: y, r: 8 + Math.min(8, hub.count || 1) }), e("text", { x, y: y - 16, textAnchor: "middle" }, hub.term));
        }),
        (graph.nodes || []).map((node) => {
          const p = layout.pos[node.id]; if (!p) return null;
          const live = visibleIds.has(node.id);
          return e("g", { key: node.id, className: `mm-node ${node.kind} ${live ? "live" : "dim"}`, onMouseMove: () => setSelected(detailFromNode(node)), onClick: () => setSelected(detailFromNode(node)), role: "button", tabIndex: 0 },
            e("circle", { cx: p.x, cy: p.y, r: 7 + Math.min(13, importance(node) * 1.2), style: { fill: color(node.kind) } }),
            p.priority ? e("text", { x: p.x + 16, y: p.y + 4 }, sourceLabel(node)) : null
          );
        }),
        e("g", { className: "mm-core", onClick: () => setSelected(null) }, e("circle", { cx: 500, cy: 500, r: 58 }), e("text", { x: 500, y: 505, textAnchor: "middle" }, "core"))
      )
    );
  }

  function MemoryMandalaPage() {
    const [state, setState] = hooks.useState(null);
    const [loading, setLoading] = hooks.useState(true);
    const [error, setError] = hooks.useState(null);
    const [saving, setSaving] = hooks.useState(false);
    const [selected, setSelected] = hooks.useState(null);
    const [query, setQuery] = hooks.useState("");
    const [kind, setKind] = hooks.useState(null);
    const [term, setTerm] = hooks.useState(null);
    const load = hooks.useCallback(async () => {
      try { setError(null); setState(await fetchJSON(`${API}/state`)); setLoading(false); }
      catch (err) { setError(err instanceof Error ? err.message : String(err)); setLoading(false); }
    }, []);
    hooks.useEffect(() => { load(); }, [load]);
    const save = async (force) => {
      setSaving(true);
      try { await fetchJSON(`${API}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: !!force }) }); await load(); }
      catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      finally { setSaving(false); }
    };
    if (loading) return e("div", { className: "mm-page mm-loading" }, "loading mandala…");
    if (error) return e("div", { className: "mm-page mm-loading" }, e("p", null, error), e("button", { onClick: load }, "retry"));
    const structure = state?.genome?.structure || { memory_graph: { nodes: [], connections: [], hubs: [] } };
    const graph = structure.memory_graph || { nodes: [], connections: [], hubs: [] };
    const layout = layoutGraph(graph);
    const visible = (graph.nodes || []).filter((n) => matches(n, query, kind, term));
    const visibleIds = new Set(visible.map((n) => n.id));
    const reset = () => { setQuery(""); setKind(null); setTerm(null); setSelected(null); };
    return e("div", { className: "mm-page" }, e("main", { className: "mm-app" },
      e(UnifiedInspector, { graph, layout, selected, setSelected, query, setQuery, kind, setKind, term, setTerm, reset, save, saving, state }),
      e(Mandala, { graph, layout, visibleIds, selected, setSelected, setKind, setTerm })
    ));
  }

  function MemoryMandalaBadge() {
    return e("a", { className: "mm-header-badge", href: "#/memory-mandala", title: "Memory Mandala" }, e("span", null), "memory mandala");
  }
  window.__HERMES_PLUGINS__.register("memory-mandala", MemoryMandalaPage);
  if (window.__HERMES_PLUGINS__.registerSlot) window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "header-right", MemoryMandalaBadge);
})();
