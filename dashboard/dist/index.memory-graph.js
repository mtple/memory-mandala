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
  const DOMAIN = {
    identity: { short: "id", css: "--mm-identity" },
    preferences: { short: "pref", css: "--mm-preferences" },
    projects: { short: "proj", css: "--mm-projects" },
    skills: { short: "skill", css: "--mm-skills" },
    safety: { short: "safe", css: "--mm-safety" },
    recent: { short: "new", css: "--mm-recent" }
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

  function cssColor(kind) {
    return `var(${DOMAIN[kind]?.css || "--color-primary"})`;
  }

  function sectionById(structure, id) {
    return (structure.sections || []).find((s) => s.id === id);
  }

  function polar(cx, cy, r, index, total, twist) {
    const angle = -Math.PI / 2 + (Math.PI * 2 * index / Math.max(1, total)) + (twist || 0);
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r];
  }

  function setSelection(kind, payload, setSelected, setDetail) {
    if (payload && payload.kind) setSelected(payload.kind);
    if (kind === "section") setSelected(payload.id);
    setDetail({ kind, ...payload });
  }

  function MemoryGraph({ structure, selected, setSelected, detail, setDetail }) {
    const graph = structure.memory_graph || { nodes: [], connections: [], hubs: [] };
    const nodes = graph.nodes || [];
    const connections = graph.connections || [];
    const hubs = graph.hubs || [];
    const cx = 380;
    const cy = 330;
    const nodePos = {};
    nodes.forEach((node, idx) => {
      const ring = node.kind === "skills" ? 265 : node.kind === "safety" ? 230 : node.kind === "identity" ? 150 : 195 + ((idx % 3) * 28);
      const [x, y] = polar(cx, cy, ring, idx, nodes.length, (node.weight || 1) * 0.025);
      nodePos[node.id] = { x, y };
    });

    return e("div", { className: "mm-map-wrap mm-graph-wrap" },
      e("svg", { viewBox: "0 0 760 680", className: "mm-map-svg", role: "img", "aria-label": "Evidence graph of actual Hermes memory facts" },
        e("defs", null,
          e("filter", { id: "mm-soft-glow" },
            e("feGaussianBlur", { stdDeviation: "4", result: "blur" }),
            e("feMerge", null, e("feMergeNode", { in: "blur" }), e("feMergeNode", { in: "SourceGraphic" }))
          )
        ),
        e("rect", { width: 760, height: 680, className: "mm-map-bg" }),
        hubs.slice(0, 5).map((hub, idx) => {
          const r = 64 + idx * 38;
          return e("g", { key: `hub-${hub.term}`, className: "mm-hub-ring", onClick: () => setSelection("hub", {
            title: hub.term,
            text: `${hub.term} appears in ${hub.count} remembered facts.`,
            meta: "repeated memory term"
          }, setSelected, setDetail) },
            e("circle", { cx, cy, r, style: { stroke: `var(${["--mm-projects", "--mm-preferences", "--mm-identity", "--mm-recent", "--mm-skills"][idx]})` } }),
            e("text", { x: cx + r + 10, y: cy - 4 + idx * 7, className: "mm-hub-label" }, hub.term)
          );
        }),
        connections.map((conn) => {
          const a = nodePos[conn.from];
          const b = nodePos[conn.to];
          if (!a || !b) return null;
          const active = detail && (detail.id === conn.id || detail.id === conn.from || detail.id === conn.to);
          return e("g", { key: conn.id, className: `mm-real-connection ${active ? "active" : ""}`, onClick: () => setSelection("connection", {
            id: conn.id,
            title: conn.shared_terms.join(" + "),
            text: `${conn.from_label} ↔ ${conn.to_label}`,
            meta: conn.reason,
            evidence: conn.evidence,
            kind: conn.from_kind || selected
          }, setSelected, setDetail) },
            e("line", { x1: a.x, y1: a.y, x2: b.x, y2: b.y, strokeWidth: Math.min(5, 1 + conn.weight) }),
            e("circle", { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, r: 3 + Math.min(5, conn.shared_terms.length), className: "mm-connection-joint" })
          );
        }),
        nodes.map((node) => {
          const p = nodePos[node.id] || { x: cx, y: cy };
          const active = detail && detail.id === node.id;
          const size = 11 + Math.min(18, (node.weight || 1) * 2.2);
          return e("g", {
            key: node.id,
            className: `mm-fact-node ${node.kind} ${active ? "active" : ""}`,
            role: "button",
            tabIndex: 0,
            "aria-label": `${node.source}: ${node.text}`,
            onClick: () => setSelection("memory fact", {
              id: node.id,
              title: node.source,
              text: node.text,
              meta: (node.terms || []).join(", "),
              kind: node.kind
            }, setSelected, setDetail),
            onKeyDown: (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setSelection("memory fact", { id: node.id, title: node.source, text: node.text, meta: (node.terms || []).join(", "), kind: node.kind }, setSelected, setDetail);
              }
            }
          },
            e("circle", { cx: p.x, cy: p.y, r: size, className: "mm-node-shell", style: { fill: cssColor(node.kind) } }),
            e("text", { x: p.x, y: p.y + 4, textAnchor: "middle", className: "mm-fact-kind" }, DOMAIN[node.kind]?.short || "mem"),
            e("text", { x: p.x, y: p.y + size + 16, textAnchor: "middle", className: "mm-fact-label" }, short(node.text, 34))
          );
        }),
        e("g", { className: "mm-graph-core", onClick: () => setSelection("overview", {
          title: "This Hermes memory graph",
          text: `${structure.summary.fact_count || 0} real facts, ${structure.summary.connection_count || 0} evidence-backed connections, ${structure.summary.source_count || 0} source files.`,
          meta: `strongest hub: ${structure.summary.strongest_hub || "none"}`
        }, setSelected, setDetail) },
          e("circle", { cx, cy, r: 48 }),
          e("text", { x: cx, y: cy - 4, textAnchor: "middle" }, `${structure.summary.connection_count || 0}`),
          e("text", { x: cx, y: cy + 16, textAnchor: "middle" }, "links")
        )
      ),
      e("div", { className: "mm-map-hint" }, "every dot is a real memory line · every line shares extracted terms")
    );
  }

  function DetailPanel({ detail }) {
    if (!detail) return null;
    return e("div", { className: "mm-click-detail", role: "status" },
      e("p", { className: "mm-overline" }, detail.kind || "detail"),
      e("strong", null, detail.title || "Selected item"),
      detail.meta && e("code", null, detail.meta),
      e("span", null, detail.text || "No additional detail available."),
      detail.evidence && e("div", { className: "mm-evidence-pair" }, detail.evidence.map((item, idx) => e("blockquote", { key: idx }, item)))
    );
  }

  function DomainInspector({ section, insights, detail, setDetail }) {
    if (!section) return null;
    return e(Card, { className: `mm-inspector ${section.status}` },
      e("div", { className: "mm-inspector-top" },
        e("span", { className: "mm-domain-dot", style: { background: cssColor(section.id) } }),
        e("div", null,
          e("p", { className: "mm-overline" }, section.status === "present" ? "memory facts" : "unseen domain"),
          e("h2", null, section.label)
        ),
        e("b", null, section.count)
      ),
      e("p", { className: "mm-domain-summary" }, section.summary_text),
      e(DetailPanel, { detail }),
      section.items && section.items.length ? e("div", { className: section.id === "skills" ? "mm-evidence-list mm-skill-usage-list" : "mm-evidence-list" },
        section.items.map((item, idx) => e("button", {
          key: idx,
          className: section.id === "skills" ? "mm-evidence-item mm-skill-usage-item" : "mm-evidence-item",
          title: item.text,
          onClick: () => setDetail({
            kind: section.id === "skills" ? "skill fact" : "memory fact",
            title: item.source || section.label,
            text: item.text,
            meta: item.terms && item.terms.length ? item.terms.join(", ") : `${item.usage_count || 0} observed uses`
          })
        },
          e("code", null, section.id === "skills" ? `${item.usage_count || 0} uses` : item.source),
          e("span", null, item.text),
          section.id === "skills" && e("i", { style: { width: `${Math.max(4, Math.round((item.usage_heat || 0) * 100))}%` } })
        ))
      ) : e("p", { className: "mm-gap-copy" }, section.recommendation),
      e("div", { className: "mm-insight-strip" },
        (insights.takeaways || []).slice(0, 2).map((item, idx) => e("button", {
          key: idx,
          className: `mm-mini-insight ${item.kind}`,
          onClick: () => setDetail({ kind: item.kind || "insight", title: item.title, text: item.text, meta: "memory graph insight" })
        }, e("strong", null, item.title), e("span", null, short(item.text, 96))))
      )
    );
  }

  function DomainRail({ structure, selected, setSelected, setDetail }) {
    return e("div", { className: "mm-domain-rail" }, ORDER.map((id) => {
      const section = sectionById(structure, id);
      if (!section) return null;
      return e("button", {
        key: id,
        className: `mm-rail-item ${section.status} ${selected === id ? "selected" : ""}`,
        onClick: () => setSelection("section", { id, title: section.label, text: section.summary_text, meta: `${section.count} actual facts` }, setSelected, setDetail)
      },
        e("span", { style: { background: cssColor(id) } }),
        e("strong", null, section.label),
        e("em", null, section.status === "present" ? `${section.count} facts` : "no fact found")
      );
    }));
  }

  function ConnectionPanel({ structure, setSelected, setDetail }) {
    const graph = structure.memory_graph || { connections: [], hubs: [] };
    return e(Card, { className: "mm-relationships" },
      e("div", { className: "mm-card-head" },
        e("div", null, e("p", { className: "mm-overline" }, "real links"), e("h2", null, "Evidence connections")),
        e("span", null, `${graph.connections.length} links`)
      ),
      graph.connections.length ? graph.connections.slice(0, 12).map((conn) => e("button", { className: "mm-edge-row", key: conn.id, onClick: () => setSelection("connection", {
        id: conn.id,
        title: conn.shared_terms.join(" + "),
        text: `${conn.from_label} ↔ ${conn.to_label}`,
        meta: conn.reason,
        evidence: conn.evidence,
        kind: conn.from_kind
      }, setSelected, setDetail) },
        e("code", null, conn.shared_terms.slice(0, 2).join(" + ")), e("p", null, short(conn.from_label, 54)), e("p", null, short(conn.to_label, 54))
      )) : e("p", { className: "mm-muted" }, "No real connections yet. Repeated concrete terms across memory facts will create links.")
    );
  }

  function Timeline({ timeline, current, setCurrent }) {
    return e(Card, { className: "mm-timeline-card" },
      e("div", { className: "mm-card-head" }, e("div", null, e("p", { className: "mm-overline" }, "history"), e("h2", null, "Evolution")), e("span", null, `${timeline.length} snapshots`)),
      timeline.length ? e("div", { className: "mm-timeline" }, timeline.slice().reverse().map((snap) => e("button", {
        key: snap.id,
        className: `mm-snapshot ${current && current.id === snap.id ? "active" : ""}`,
        onClick: () => setCurrent({ ...snap, sources: [], skills: [] })
      },
        e("strong", null, snap.structure && snap.structure.summary ? `${snap.structure.summary.connection_count || 0} real links` : snap.reason),
        e("span", null, snap.insights && snap.insights.headline ? snap.insights.headline : new Date(snap.created_at).toLocaleString())
      ))) : e("p", { className: "mm-muted" }, "No snapshots yet. Save one after meaningful memory changes.")
    );
  }

  function MemoryMandalaPage() {
    const [state, setState] = hooks.useState(null);
    const [current, setCurrent] = hooks.useState(null);
    const [selected, setSelected] = hooks.useState("identity");
    const [loading, setLoading] = hooks.useState(true);
    const [error, setError] = hooks.useState(null);
    const [saving, setSaving] = hooks.useState(false);
    const [detail, setDetail] = hooks.useState(null);

    const load = hooks.useCallback(async () => {
      setError(null);
      try {
        const s = await fetchJSON(`${API}/state`);
        setState(s);
        setCurrent(s.genome);
        setLoading(false);
        fetchJSON(`${API}/current`).then((c) => { if (c && c.structure) setCurrent(c); }).catch(() => {});
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      }
    }, []);

    hooks.useEffect(() => { load(); }, [load]);

    const save = async (force) => {
      setSaving(true); setError(null);
      try {
        const snap = await fetchJSON(`${API}/generate`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ force: !!force }) });
        setCurrent(snap);
        await load();
      } catch (err) { setError(err instanceof Error ? err.message : String(err)); }
      finally { setSaving(false); }
    };

    if (loading) return e("div", { className: "mm-page" }, e("div", { className: "mm-loading" }, "loading memory graph…"));
    if (error) return e("div", { className: "mm-page" }, e(Card, null, e("p", null, error), e(Button, { onClick: load }, "retry")));

    const genome = state && state.genome || current || {};
    const active = current && current.structure ? current : genome;
    const structure = active.structure || { sections: [], summary: {}, edges: [], memory_graph: { nodes: [], connections: [], hubs: [] } };
    const insights = active.insights || genome.insights || {};
    const timeline = state && state.timeline || [];
    const selectedSection = sectionById(structure, selected) || (structure.sections || [])[0];
    const summary = structure.summary || {};

    return e("div", { className: "mm-page" },
      e("header", { className: "mm-hero" },
        e("div", null,
          e("p", { className: "mm-overline" }, "memory mandala · evidence graph"),
          e("h1", null, "The actual memory system"),
          e("p", { className: "mm-subtitle" }, "This map is built from remembered lines and skills. Dots are concrete facts. Lines only appear when facts share extracted terms.")
        ),
        e("div", { className: "mm-actions" },
          state && state.has_unbloomed_changes && e("span", { className: "mm-badge" }, "memory changed"),
          e(Button, { onClick: () => save(false), disabled: saving }, saving ? "saving…" : "save snapshot"),
          e(Button, { onClick: () => save(true), disabled: saving, className: "secondary" }, "force")
        )
      ),
      e("section", { className: "mm-live-summary" },
        e("button", { onClick: () => setDetail({ kind: "metric", title: "Facts", text: `${summary.fact_count || 0} concrete memory facts were extracted from files and skills.`, meta: `${summary.source_count || 0} sources` }) }, e("span", null, "facts"), e("strong", null, summary.fact_count || 0), e("em", null, "real memory lines")),
        e("button", { onClick: () => setDetail({ kind: "metric", title: "Connections", text: `${summary.connection_count || 0} links are backed by shared extracted terms.`, meta: "no template links" }) }, e("span", null, "connections"), e("strong", null, summary.connection_count || 0), e("em", null, "shared terms only")),
        e("button", { onClick: () => setDetail({ kind: "metric", title: "Strongest hub", text: summary.strongest_terms && summary.strongest_terms.length ? summary.strongest_terms.join(", ") : "No repeated concrete terms found yet.", meta: "memory hubs" }) }, e("span", null, "strongest hub"), e("strong", null, summary.strongest_hub || "none"), e("em", null, "repeated term")),
        e("button", { onClick: () => setDetail({ kind: "metric", title: "Sources", text: `${summary.source_count || 0} memory files and ${summary.total_skills || 0} skills are represented.`, meta: "local Hermes home" }) }, e("span", null, "sources"), e("strong", null, summary.source_count || 0), e("em", null, `${summary.total_skills || 0} skills`))
      ),
      e("main", { className: "mm-stage" },
        e("div", null,
          e(MemoryGraph, { structure, selected, setSelected, detail, setDetail }),
          e(DomainRail, { structure, selected, setSelected, setDetail })
        ),
        e("aside", { className: "mm-side" },
          e(DomainInspector, { section: selectedSection, insights, detail, setDetail }),
          e(ConnectionPanel, { structure, setSelected, setDetail })
        )
      ),
      e(Timeline, { timeline, current: active, setCurrent })
    );
  }

  function MemoryMandalaBadge() {
    const [state, setState] = hooks.useState(null);
    hooks.useEffect(() => { fetchJSON(`${API}/state`).then(setState).catch(() => {}); }, []);
    const links = state && state.genome && state.genome.structure ? state.genome.structure.summary.connection_count : null;
    return e("a", { className: "mm-header-badge", href: "#/memory-mandala", title: "Memory Mandala" },
      e("span", { className: state && state.has_unbloomed_changes ? "pulse" : "" }),
      links === null ? "memory graph" : `${links} memory links`
    );
  }

  function SlotBanner() {
    return e("div", { className: "mm-slot-banner" },
      e("strong", null, "Memory Mandala"),
      e("span", null, "Inspect concrete facts and real shared-term connections in memory.")
    );
  }

  window.__HERMES_PLUGINS__.register("memory-mandala", MemoryMandalaPage);
  if (window.__HERMES_PLUGINS__.registerSlot) {
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "header-right", MemoryMandalaBadge);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "sessions:top", SlotBanner);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "skills:top", SlotBanner);
  }
})();
