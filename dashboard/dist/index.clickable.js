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
    identity: { short: "ID", icon: "◈", css: "--mm-identity", angle: -90 },
    preferences: { short: "UX", icon: "◒", css: "--mm-preferences", angle: -30 },
    projects: { short: "PR", icon: "▧", css: "--mm-projects", angle: 30 },
    skills: { short: "SK", icon: "⌘", css: "--mm-skills", angle: 90 },
    safety: { short: "SF", icon: "◇", css: "--mm-safety", angle: 150 },
    recent: { short: "RC", icon: "✦", css: "--mm-recent", angle: 210 }
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

  function polar(cx, cy, r, deg) {
    const a = (deg * Math.PI) / 180;
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }

  function sectionById(structure, id) {
    return (structure.sections || []).find((s) => s.id === id);
  }

  function cssColor(id) {
    return `var(${DOMAIN[id]?.css || "--color-primary"})`;
  }

  function selectDomain(id, setSelected, setDetail, detail) {
    setSelected(id);
    if (setDetail) setDetail(detail || null);
  }

  function MemoryMap({ structure, selected, hovered, setSelected, setHovered, setDetail }) {
    const summary = structure.summary || {};
    const cx = 360;
    const cy = 360;
    const rings = ORDER.map((id, i) => {
      const section = sectionById(structure, id);
      if (!section) return null;
      const r = 92 + i * 34;
      const dash = section.status === "present" ? `${Math.max(12, section.count * 2)} ${Math.max(10, 42 - section.count)}` : "4 12";
      return e("circle", {
        key: `ring-${id}`,
        cx, cy, r,
        className: `mm-ring ${section.status} ${selected === id ? "selected" : ""}`,
        style: { stroke: cssColor(id) },
        strokeDasharray: dash,
        onClick: () => selectDomain(id, setSelected, setDetail, {
          kind: "domain ring",
          title: section.label,
          text: section.summary_text || section.recommendation || "No detail yet.",
          meta: `${section.count} signals · ${section.status}`
        })
      });
    });

    const nodes = ORDER.map((id) => {
      const section = sectionById(structure, id);
      if (!section) return null;
      const active = selected === id || hovered === id;
      const [x, y] = polar(cx, cy, 260, DOMAIN[id].angle);
      const [lx, ly] = polar(cx, cy, 315, DOMAIN[id].angle);
      const size = section.status === "present" ? 54 : 44;
      return e("g", {
        key: `node-${id}`,
        className: `mm-node ${section.status} ${active ? "active" : ""}`,
        tabIndex: 0,
        role: "button",
        "aria-label": `${section.label}: ${section.status}`,
        onClick: () => selectDomain(id, setSelected, setDetail, {
          kind: "memory domain",
          title: section.label,
          text: section.summary_text || section.recommendation || "No detail yet.",
          meta: `${section.count} signals · ${section.status}`
        }),
        onKeyDown: (event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            selectDomain(id, setSelected, setDetail, {
              kind: "memory domain",
              title: section.label,
              text: section.summary_text || section.recommendation || "No detail yet.",
              meta: `${section.count} signals · ${section.status}`
            });
          }
        },
        onMouseEnter: () => setHovered(id),
        onMouseLeave: () => setHovered(null),
        onFocus: () => setHovered(id),
        onBlur: () => setHovered(null)
      },
        e("line", { x1: cx, y1: cy, x2: x, y2: y, className: "mm-spoke", style: { stroke: cssColor(id) } }),
        e("circle", { cx: x, cy: y, r: size, className: "mm-node-shell", style: { fill: cssColor(id) } }),
        e("circle", { cx: x, cy: y, r: Math.max(14, Math.min(36, 12 + section.count * 3)), className: "mm-node-meter" }),
        e("text", { x, y: y - 4, textAnchor: "middle", className: "mm-node-code" }, DOMAIN[id].short),
        e("text", { x, y: y + 16, textAnchor: "middle", className: "mm-node-count" }, section.count),
        e("text", { x: lx, y: ly, textAnchor: "middle", className: "mm-node-label" }, section.label),
        e("text", { x: lx, y: ly + 17, textAnchor: "middle", className: `mm-node-status ${section.status}` }, section.status === "present" ? "mapped" : "gap")
      );
    });

    const edges = (structure.edges || []).map((edge, idx) => {
      const a = DOMAIN[edge.from];
      const b = DOMAIN[edge.to];
      if (!a || !b) return null;
      const [x1, y1] = polar(cx, cy, 260, a.angle);
      const [x2, y2] = polar(cx, cy, 260, b.angle);
      const active = selected === edge.from || selected === edge.to || hovered === edge.from || hovered === edge.to;
      return e("path", {
        key: `edge-${idx}`,
        d: `M ${x1} ${y1} Q ${cx} ${cy} ${x2} ${y2}`,
        className: `mm-edge-path ${active ? "active" : ""}`,
        onClick: () => selectDomain(edge.from, setSelected, setDetail, {
          kind: "relationship",
          title: `${edge.from} → ${edge.to}`,
          text: edge.reason,
          meta: "active relationship"
        })
      });
    });

    const selectedSection = sectionById(structure, selected) || sectionById(structure, hovered) || sectionById(structure, "projects") || (structure.sections || [])[0];
    const coverage = Math.round((summary.coverage || 0) * 100);

    return e("div", { className: "mm-map-wrap" },
      e("svg", { viewBox: "0 0 720 720", className: "mm-map-svg", role: "img", "aria-label": "Interactive living map of agent memory" },
        e("defs", null,
          e("radialGradient", { id: "mm-core-glow", cx: "50%", cy: "50%" },
            e("stop", { offset: "0%", stopColor: "var(--color-primary)", stopOpacity: "0.36" }),
            e("stop", { offset: "100%", stopColor: "var(--color-background)", stopOpacity: "0" })
          ),
          e("filter", { id: "mm-soft-glow" },
            e("feGaussianBlur", { stdDeviation: "4", result: "blur" }),
            e("feMerge", null, e("feMergeNode", { in: "blur" }), e("feMergeNode", { in: "SourceGraphic" }))
          )
        ),
        e("rect", { width: 720, height: 720, className: "mm-map-bg" }),
        e("circle", { cx, cy, r: 324, className: "mm-breath-ring one" }),
        e("circle", { cx, cy, r: 286, className: "mm-breath-ring two" }),
        rings,
        edges,
        e("circle", { cx, cy, r: 96, fill: "url(#mm-core-glow)", className: "mm-core-halo" }),
        e("circle", { cx, cy, r: 74, className: "mm-core", onClick: () => {
          setDetail({
            kind: "overview",
            title: "Memory coverage",
            text: `${coverage}% mapped across ${summary.present_sections || 0}/6 domains. Primary gap: ${summary.primary_gap || "none"}.`,
            meta: `${summary.total_skills || 0} skills installed`
          });
        } }),
        e("text", { x: cx, y: cy - 18, textAnchor: "middle", className: "mm-core-score" }, `${coverage}%`),
        e("text", { x: cx, y: cy + 6, textAnchor: "middle", className: "mm-core-label" }, "memory mapped"),
        e("text", { x: cx, y: cy + 30, textAnchor: "middle", className: "mm-core-sub" }, `${summary.present_sections || 0}/6 domains · ${summary.total_skills || 0} skills`),
        nodes,
        selectedSection && e("g", { className: "mm-orbit-caption" },
          e("text", { x: cx, y: 688, textAnchor: "middle" }, `${selectedSection.label}: ${short(selectedSection.summary_text, 82)}`)
        )
      ),
      e("div", { className: "mm-map-hint" }, "click any memory domain")
    );
  }

  function DetailPanel({ detail }) {
    if (!detail) return null;
    return e("div", { className: "mm-click-detail", role: "status" },
      e("p", { className: "mm-overline" }, detail.kind || "detail"),
      e("strong", null, detail.title || "Selected item"),
      detail.meta && e("code", null, detail.meta),
      e("span", null, detail.text || "No additional detail available yet.")
    );
  }

  function DomainInspector({ section, insights, detail, setDetail }) {
    if (!section) return null;
    return e(Card, { className: `mm-inspector ${section.status}` },
      e("div", { className: "mm-inspector-top" },
        e("span", { className: "mm-domain-dot", style: { background: cssColor(section.id) } }),
        e("div", null,
          e("p", { className: "mm-overline" }, section.status === "present" ? "selected domain" : "open gap"),
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
            kind: section.id === "skills" ? "skill usage" : "memory evidence",
            title: section.id === "skills" ? item.text : (item.source || section.label),
            text: item.text,
            meta: section.id === "skills" ? `${item.usage_count || 0} observed uses` : item.source
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
          onClick: () => setDetail({
            kind: item.kind || "insight",
            title: item.title,
            text: item.text,
            meta: "generated insight"
          })
        },
          e("strong", null, item.title),
          e("span", null, short(item.text, 96))
        ))
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
        onClick: () => selectDomain(id, setSelected, setDetail, {
          kind: "domain tab",
          title: section.label,
          text: section.summary_text || section.recommendation || "No detail yet.",
          meta: `${section.count} signals · ${section.status}`
        })
      },
        e("span", { style: { background: cssColor(id) } }),
        e("strong", null, section.label),
        e("em", null, section.status === "present" ? `${section.count} signals` : "needs memory")
      );
    }));
  }

  function RelationshipPanel({ structure, setSelected, setDetail }) {
    const edges = structure.edges || [];
    return e(Card, { className: "mm-relationships" },
      e("div", { className: "mm-card-head" },
        e("div", null, e("p", { className: "mm-overline" }, "living links"), e("h2", null, "Active relationships")),
        e("span", null, `${edges.length} links`)
      ),
      edges.length ? edges.map((edge, idx) => e("button", { className: "mm-edge-row", key: idx, onClick: () => selectDomain(edge.from, setSelected, setDetail, {
        kind: "relationship",
        title: `${edge.from} → ${edge.to}`,
        text: edge.reason,
        meta: "active relationship"
      }) },
        e("code", null, edge.from), e("span", null, "→"), e("code", null, edge.to), e("p", null, edge.reason)
      )) : e("p", { className: "mm-muted" }, "Relationships appear when domains both have evidence.")
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
        e("strong", null, snap.structure && snap.structure.summary ? `${Math.round(snap.structure.summary.coverage * 100)}% mapped` : snap.reason),
        e("span", null, snap.insights && snap.insights.headline ? snap.insights.headline : new Date(snap.created_at).toLocaleString())
      ))) : e("p", { className: "mm-muted" }, "No snapshots yet. Save one after meaningful memory changes.")
    );
  }

  function MemoryMandalaPage() {
    const [state, setState] = hooks.useState(null);
    const [current, setCurrent] = hooks.useState(null);
    const [selected, setSelected] = hooks.useState("identity");
    const [hovered, setHovered] = hooks.useState(null);
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
        fetchJSON(`${API}/current`).then((c) => {
          if (c && c.structure && c.structure.sections && c.structure.sections.some((section) => section.summary_text)) {
            setCurrent(c);
          }
        }).catch(() => {
          // Snapshot loading is non-critical; the live genome is enough to render the map.
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
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

    if (loading) return e("div", { className: "mm-page" }, e("div", { className: "mm-loading" }, "loading living memory map…"));
    if (error) return e("div", { className: "mm-page" }, e(Card, null, e("p", null, error), e(Button, { onClick: load }, "retry")));

    const genome = state && state.genome || current || {};
    const currentLooksCurrent = current && current.structure && current.structure.sections && current.structure.sections.some((s) => s.summary_text);
    const active = currentLooksCurrent ? current : genome;
    const structure = active.structure || genome.structure || { sections: [], summary: {}, edges: [] };
    const insights = active.insights || genome.insights || {};
    const timeline = state && state.timeline || [];
    const selectedSection = sectionById(structure, selected) || (structure.sections || [])[0];
    const summary = structure.summary || {};

    return e("div", { className: "mm-page" },
      e("header", { className: "mm-hero" },
        e("div", null,
          e("p", { className: "mm-overline" }, "memory mandala · living map"),
          e("h1", null, "Agent memory, at a glance"),
          e("p", { className: "mm-subtitle" }, "Click the map to inspect each memory domain. Motion shows active relationships; gaps stay dim until backed by real memory evidence.")
        ),
        e("div", { className: "mm-actions" },
          state && state.has_unbloomed_changes && e("span", { className: "mm-badge" }, "new shape available"),
          e(Button, { onClick: () => save(false), disabled: saving }, saving ? "saving…" : "save snapshot"),
          e(Button, { onClick: () => save(true), disabled: saving, className: "secondary" }, "force")
        )
      ),
      e("section", { className: "mm-live-summary" },
        e("button", { onClick: () => setDetail({ kind: "metric", title: "Coverage", text: `${Math.round((summary.coverage || 0) * 100)}% of memory domains have supporting evidence.`, meta: summary.coverage_label || "unknown" }) }, e("span", null, "coverage"), e("strong", null, `${Math.round((summary.coverage || 0) * 100)}%`), e("em", null, summary.coverage_label || "unknown")),
        e("button", { onClick: () => setDetail({ kind: "metric", title: "Mapped domains", text: `${summary.present_sections || 0} of 6 memory domains currently have evidence.`, meta: "memory domains" }) }, e("span", null, "mapped"), e("strong", null, `${summary.present_sections || 0}/6`), e("em", null, "memory domains")),
        e("button", { onClick: () => {
          const gap = summary.primary_gap || "none";
          const target = ORDER.find((id) => sectionById(structure, id)?.label?.toLowerCase() === String(gap).toLowerCase()) || "recent";
          selectDomain(target, setSelected, setDetail, { kind: "metric", title: "Primary gap", text: gap === "none" ? "No obvious gap right now." : `Next useful memory domain: ${gap}.`, meta: "next useful memory" });
        } }, e("span", null, "primary gap"), e("strong", null, summary.primary_gap || "none"), e("em", null, "next useful memory")),
        e("button", { onClick: () => selectDomain("skills", setSelected, setDetail, { kind: "metric", title: "Skills", text: `${summary.total_skills || 0} reusable procedures are installed. The skills panel ranks them by recent observed usage.`, meta: "procedures installed" }) }, e("span", null, "skills"), e("strong", null, summary.total_skills || 0), e("em", null, "procedures installed"))
      ),
      e("main", { className: "mm-stage" },
        e("div", null,
          e(MemoryMap, { structure, selected, hovered, setSelected, setHovered, setDetail }),
          e(DomainRail, { structure, selected, setSelected, setDetail })
        ),
        e("aside", { className: "mm-side" },
          e(DomainInspector, { section: selectedSection, insights, detail, setDetail }),
          e(RelationshipPanel, { structure, setSelected, setDetail })
        )
      ),
      e(Timeline, { timeline, current: active, setCurrent })
    );
  }

  function MemoryMandalaBadge() {
    const [state, setState] = hooks.useState(null);
    hooks.useEffect(() => { fetchJSON(`${API}/state`).then(setState).catch(() => {}); }, []);
    const coverage = state && state.genome && state.genome.structure ? Math.round(state.genome.structure.summary.coverage * 100) : null;
    return e("a", { className: "mm-header-badge", href: "#/memory-mandala", title: "Memory Mandala" },
      e("span", { className: state && state.has_unbloomed_changes ? "pulse" : "" }),
      coverage === null ? "memory map" : `${coverage}% mapped`
    );
  }

  function SlotBanner() {
    return e("div", { className: "mm-slot-banner" },
      e("strong", null, "Memory Mandala"),
      e("span", null, "Click through a living, theme-aware map of agent memory domains.")
    );
  }

  window.__HERMES_PLUGINS__.register("memory-mandala", MemoryMandalaPage);
  if (window.__HERMES_PLUGINS__.registerSlot) {
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "header-right", MemoryMandalaBadge);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "sessions:top", SlotBanner);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "skills:top", SlotBanner);
  }
})();
