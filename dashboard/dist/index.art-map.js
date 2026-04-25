(function () {
  "use strict";

  const SDK = window.__HERMES_PLUGIN_SDK__ || {};
  const React = SDK.React;
  const hooks = SDK.hooks || React;
  const C = SDK.components || {};
  const fetchJSON = SDK.fetchJSON || ((url, opts) => fetch(url, opts).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  }));
  const API = "/api/plugins/memory-mandala";
  const e = React.createElement;

  const ORDER = ["identity", "preferences", "projects", "skills", "safety", "recent"];
  const FALLBACK_COLORS = {
    identity: "#8b5cf6",
    preferences: "#ec4899",
    projects: "#06b6d4",
    skills: "#f59e0b",
    safety: "#ef4444",
    recent: "#10b981"
  };

  function Card(props) {
    const Comp = C.Card || "section";
    return e(Comp, { className: `mm-card ${props.className || ""}` }, props.children);
  }

  function Button(props) {
    const Comp = C.Button || "button";
    return e(Comp, { ...props, className: `mm-button ${props.className || ""}` }, props.children);
  }

  function short(text, max) {
    if (!text) return "unmapped";
    return text.length > max ? text.slice(0, max - 1) + "…" : text;
  }

  function polar(cx, cy, r, a) {
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }

  function petalPath(cx, cy, inner, outer, start, end) {
    const mid = (start + end) / 2;
    const [p1x, p1y] = polar(cx, cy, inner, start);
    const [p2x, p2y] = polar(cx, cy, inner, end);
    const [tipx, tipy] = polar(cx, cy, outer, mid);
    const [c1x, c1y] = polar(cx, cy, outer * 0.94, start + 0.08);
    const [c2x, c2y] = polar(cx, cy, outer * 0.94, end - 0.08);
    return `M ${p1x.toFixed(2)} ${p1y.toFixed(2)} C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${tipx.toFixed(2)} ${tipy.toFixed(2)}, ${tipx.toFixed(2)} ${tipy.toFixed(2)} C ${tipx.toFixed(2)} ${tipy.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${p2x.toFixed(2)} ${p2y.toFixed(2)} Q ${cx} ${cy} ${p1x.toFixed(2)} ${p1y.toFixed(2)} Z`;
  }

  function MandalaArt({ structure }) {
    const sections = ORDER.map((id) => (structure.sections || []).find((s) => s.id === id)).filter(Boolean);
    const summary = structure.summary || {};
    const cx = 360;
    const cy = 360;
    const slice = Math.PI * 2 / Math.max(1, sections.length);

    const petals = [];
    const detail = [];
    const labels = [];

    sections.forEach((section, i) => {
      const start = -Math.PI / 2 + i * slice + 0.03;
      const end = start + slice - 0.06;
      const color = (structure.art_layers || []).find((l) => l.id === section.id)?.color || FALLBACK_COLORS[section.id] || "#999";
      const opacity = section.status === "present" ? 0.92 : 0.16;
      const motifCount = Math.max(3, Math.min(10, section.count || 2));
      petals.push(e("path", {
        key: `outer-${section.id}`,
        d: petalPath(cx, cy, 116, 292, start, end),
        fill: color,
        fillOpacity: opacity,
        stroke: "#111111",
        strokeWidth: 3,
        className: section.status === "gap" ? "mm-svg-gap" : ""
      }));
      petals.push(e("path", {
        key: `mid-${section.id}`,
        d: petalPath(cx, cy, 74, 178, start + 0.09, end - 0.09),
        fill: "#ffffff",
        fillOpacity: 0.72,
        stroke: "#111111",
        strokeWidth: 2
      }));
      for (let j = 0; j < motifCount; j++) {
        const a = start + (j + 0.5) * ((end - start) / motifCount);
        const [x, y] = polar(cx, cy, 224, a);
        detail.push(e("circle", {
          key: `dot-${section.id}-${j}`,
          cx: x,
          cy: y,
          r: section.status === "present" ? 7 : 4,
          fill: section.status === "present" ? "#ffe66d" : "#ffffff",
          stroke: "#111111",
          strokeWidth: 2
        }));
      }
      const mid = (start + end) / 2;
      const [lx, ly] = polar(cx, cy, 338, mid);
      labels.push(e("g", { key: `label-${section.id}` },
        e("text", { x: lx, y: ly - 8, textAnchor: "middle", className: "mm-svg-label" }, section.label),
        e("text", { x: lx, y: ly + 10, textAnchor: "middle", className: section.status === "present" ? "mm-svg-status present" : "mm-svg-status gap" }, section.status === "present" ? "mapped" : "gap")
      ));
    });

    return e("div", { className: "mm-art-wrap" },
      e("svg", { viewBox: "0 0 720 720", className: "mm-mandala-svg", role: "img", "aria-label": "Mandala-style map of agent memory structure" },
        e("rect", { width: 720, height: 720, fill: "#fffdf8" }),
        e("circle", { cx, cy, r: 310, fill: "none", stroke: "#111", strokeWidth: 2 }),
        e("circle", { cx, cy, r: 255, fill: "none", stroke: "#111", strokeWidth: 1.5, strokeDasharray: "5 8" }),
        petals,
        detail,
        e("circle", { cx, cy, r: 86, fill: "#fffdf8", stroke: "#111", strokeWidth: 3 }),
        e("circle", { cx, cy, r: 54, fill: "#fef08a", stroke: "#111", strokeWidth: 2 }),
        e("text", { x: cx, y: cy - 10, textAnchor: "middle", className: "mm-svg-core" }, `${Math.round((summary.coverage || 0) * 100)}% mapped`),
        e("text", { x: cx, y: cy + 14, textAnchor: "middle", className: "mm-svg-core-sub" }, `${summary.present_sections || 0} of 6 sections`),
        labels
      )
    );
  }

  function ReadingPanel({ structure, insights }) {
    const sections = structure.sections || [];
    const byId = Object.fromEntries(sections.map((s) => [s.id, s]));
    return e("aside", { className: "mm-reading" },
      e("div", { className: "mm-logo" }, e("strong", null, "MEMORY MANDALA"), e("span", null, "readable agent memory art")),
      e("h2", null, "What the mandala says"),
      e("p", { className: "mm-headline" }, insights.headline || "The mandala maps the current shape of agent memory."),
      ORDER.map((id) => {
        const section = byId[id];
        if (!section) return null;
        return e("div", { className: `mm-reading-row ${section.status}`, key: id },
          e("div", { className: "mm-color", style: { background: FALLBACK_COLORS[id] } }),
          e("div", null,
            e("div", { className: "mm-row-title" }, e("strong", null, section.label), e("span", null, section.status)),
            e("p", null, short(section.summary_text, 150)),
            section.items && section.items[0] && e("code", null, section.items[0].source)
          )
        );
      })
    );
  }

  function EvidencePanel({ structure }) {
    const edges = structure.edges || [];
    return e("div", { className: "mm-evidence-grid" },
      e(Card, null,
        e("h2", null, "Structure, not decoration"),
        e("p", { className: "mm-muted" }, "Each petal is a memory domain. Color identifies the domain, fill strength shows whether the domain is actually mapped, yellow beads show amount of supporting evidence, and the center shows overall coverage."),
        e("ul", { className: "mm-rules" },
          e("li", null, e("b", null, "center"), " coverage of the six durable memory domains"),
          e("li", null, e("b", null, "petals"), " identity, preferences, projects, skills, safety, recent learning"),
          e("li", null, e("b", null, "beads"), " evidence density, capped so counts do not dominate meaning"),
          e("li", null, e("b", null, "faded petals"), " gaps worth filling")
        )
      ),
      e(Card, null,
        e("h2", null, "Relationships"),
        edges.length ? edges.map((edge, idx) => e("div", { className: "mm-edge", key: idx },
          e("code", null, edge.from), e("span", null, "→"), e("code", null, edge.to), e("p", null, edge.reason)
        )) : e("p", { className: "mm-muted" }, "Relationships appear when multiple domains have evidence.")
      )
    );
  }

  function Timeline({ timeline, current, setCurrent }) {
    return e(Card, { className: "mm-timeline-card" },
      e("div", { className: "mm-card-head" }, e("h2", null, "Evolution"), e("span", null, `${timeline.length} snapshots`)),
      timeline.length ? e("div", { className: "mm-timeline" }, timeline.slice().reverse().map((snap) => e("button", {
        key: snap.id,
        className: `mm-snapshot ${current && current.id === snap.id ? "active" : ""}`,
        onClick: () => setCurrent({ ...snap, sources: [], skills: [] })
      },
        e("strong", null, snap.structure && snap.structure.summary ? `${Math.round(snap.structure.summary.coverage * 100)}% mapped` : snap.reason),
        e("span", null, snap.insights && snap.insights.headline ? snap.insights.headline : new Date(snap.created_at).toLocaleString())
      ))) : e("p", { className: "mm-muted" }, "No snapshots yet. Save one after meaningful memory changes.")
    );
  }

  function MemoryMandalaPage() {
    const [state, setState] = hooks.useState(null);
    const [current, setCurrent] = hooks.useState(null);
    const [loading, setLoading] = hooks.useState(true);
    const [error, setError] = hooks.useState(null);
    const [saving, setSaving] = hooks.useState(false);

    const load = hooks.useCallback(async () => {
      setError(null);
      try {
        const [s, c] = await Promise.all([fetchJSON(`${API}/state`), fetchJSON(`${API}/current`)]);
        setState(s); setCurrent(c);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }, []);

    hooks.useEffect(() => { load(); }, [load]);

    const save = async (force) => {
      setSaving(true); setError(null);
      try {
        const snap = await fetchJSON(`${API}/generate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ force: !!force })
        });
        setCurrent(snap);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSaving(false);
      }
    };

    if (loading) return e("div", { className: "mm-page" }, "loading memory mandala…");
    if (error) return e("div", { className: "mm-page" }, e(Card, null, e("p", null, error), e(Button, { onClick: load }, "retry")));

    const genome = state && state.genome || current || {};
    const currentLooksCurrent = current && current.structure && current.structure.art_layers && current.structure.sections && current.structure.sections.some((s) => s.summary_text);
    const active = currentLooksCurrent ? current : genome;
    const structure = active.structure || genome.structure || { sections: [], summary: {}, edges: [] };
    const insights = active.insights || genome.insights || {};
    const timeline = state && state.timeline || [];

    return e("div", { className: "mm-page" },
      e("header", { className: "mm-hero" },
        e("div", { className: "mm-logo" }, e("strong", null, "MEMORY MANDALA"), e("span", null, "beautiful, informative agent memory")),
        e("div", { className: "mm-actions" },
          state && state.has_unbloomed_changes && e("span", { className: "mm-badge" }, "new memory shape"),
          e(Button, { onClick: () => save(false), disabled: saving }, saving ? "saving…" : "save snapshot"),
          e(Button, { onClick: () => save(true), disabled: saving, className: "secondary" }, "force")
        )
      ),
      e("main", { className: "mm-stage" },
        e(MandalaArt, { structure }),
        e(ReadingPanel, { structure, insights })
      ),
      e(EvidencePanel, { structure }),
      e(Timeline, { timeline, current: active, setCurrent })
    );
  }

  function MemoryMandalaBadge() {
    const [state, setState] = hooks.useState(null);
    hooks.useEffect(() => { fetchJSON(`${API}/state`).then(setState).catch(() => {}); }, []);
    const coverage = state && state.genome && state.genome.structure ? Math.round(state.genome.structure.summary.coverage * 100) : null;
    return e("a", { className: "mm-header-badge", href: "#/memory-mandala", title: "Memory Mandala" }, coverage === null ? "memory mandala" : `${coverage}% memory map`);
  }

  function SlotBanner() {
    return e("div", { className: "mm-slot-banner" },
      e("strong", null, "Memory Mandala"),
      e("span", null, "A readable mandala of agent identity, preferences, projects, skills, safety, and recent learning.")
    );
  }

  window.__HERMES_PLUGINS__.register("memory-mandala", MemoryMandalaPage);
  if (window.__HERMES_PLUGINS__.registerSlot) {
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "header-right", MemoryMandalaBadge);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "sessions:top", SlotBanner);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "skills:top", SlotBanner);
  }
})();
