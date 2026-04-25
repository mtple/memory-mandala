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

  function Card(props) {
    const Comp = C.Card || "section";
    return e(Comp, { className: `mm-card ${props.className || ""}` }, props.children);
  }

  function Button(props) {
    const Comp = C.Button || "button";
    return e(Comp, { ...props, className: `mm-button ${props.className || ""}` }, props.children);
  }

  function Metric({ label, value, note, tone }) {
    return e("div", { className: `mm-metric ${tone || ""}` },
      e("span", null, label),
      e("strong", null, value),
      note && e("em", null, note)
    );
  }

  function StatusPill({ status }) {
    return e("span", { className: `mm-pill ${status}` }, status === "present" ? "mapped" : "gap");
  }

  function EvidenceList({ section }) {
    if (!section.items || !section.items.length) {
      return e("p", { className: "mm-recommendation" }, section.recommendation);
    }
    return e("ul", { className: "mm-evidence" }, section.items.slice(0, 3).map((item, idx) => e("li", { key: idx },
      e("span", null, item.source),
      e("p", null, item.text)
    )));
  }

  function MemorySection({ section }) {
    return e("article", { className: `mm-section ${section.status}`, "data-section": section.id },
      e("header", null,
        e("div", null,
          e("h3", null, section.label),
          e("p", null, section.description)
        ),
        e(StatusPill, { status: section.status })
      ),
      e("div", { className: "mm-count-line" },
        e("b", null, section.count),
        e("span", null, section.count === 1 ? "signal" : "signals")
      ),
      e(EvidenceList, { section })
    );
  }

  function StructureMap({ structure }) {
    const sections = structure && structure.sections || [];
    const summary = structure && structure.summary || {};
    const edges = structure && structure.edges || [];
    return e(Card, { className: "mm-map-card" },
      e("div", { className: "mm-card-head" },
        e("div", null,
          e("p", { className: "mm-overline" }, "memory map"),
          e("h2", null, "Agent memory structure")
        ),
        e("div", { className: `mm-coverage ${summary.coverage_label || "thin"}` },
          e("strong", null, Math.round((summary.coverage || 0) * 100) + "%"),
          e("span", null, summary.coverage_label || "unmapped")
        )
      ),
      e("div", { className: "mm-structure-grid" }, sections.map((section) => e(MemorySection, { key: section.id, section }))),
      e("div", { className: "mm-flows" },
        e("h3", null, "Active relationships"),
        edges.length ? edges.map((edge, idx) => e("div", { className: "mm-flow", key: idx },
          e("code", null, edge.from),
          e("span", null, "→"),
          e("code", null, edge.to),
          e("p", null, edge.reason)
        )) : e("p", { className: "mm-muted" }, "No strong relationships yet. Fill more sections to see how memory areas connect.")
      )
    );
  }

  function InsightPanel({ insights, structure }) {
    const takeaways = insights && insights.takeaways || [];
    const summary = structure && structure.summary || {};
    const gaps = structure && structure.sections ? structure.sections.filter((s) => s.status === "gap") : [];
    return e("div", { className: "mm-side" },
      e(Card, { className: "mm-read-card" },
        e("p", { className: "mm-overline" }, "first glance"),
        e("h2", null, "What this says"),
        e("p", { className: "mm-headline" }, insights && insights.headline || "Memory structure has not been analyzed yet."),
        e("div", { className: "mm-mini-metrics" },
          e(Metric, { label: "mapped", value: `${summary.present_sections || 0}/6`, note: "sections" }),
          e(Metric, { label: "gaps", value: summary.gap_sections || 0, note: summary.primary_gap ? `first: ${summary.primary_gap}` : "none", tone: summary.gap_sections ? "warn" : "ok" })
        )
      ),
      e(Card, null,
        e("h2", null, "Takeaways"),
        e("div", { className: "mm-takeaways" }, takeaways.slice(0, 5).map((item, idx) => e("div", { className: `mm-takeaway ${item.kind || "note"}`, key: idx },
          e("span", null, item.kind || "note"),
          e("strong", null, item.title),
          e("p", null, item.text)
        )))
      ),
      e(Card, null,
        e("h2", null, "Open gaps"),
        gaps.length ? e("ul", { className: "mm-gap-list" }, gaps.map((gap) => e("li", { key: gap.id },
          e("strong", null, gap.label),
          e("p", null, gap.recommendation)
        ))) : e("p", { className: "mm-muted" }, "No major gaps detected. Next useful step is comparison over time.")
      )
    );
  }

  function SourceTable({ genome }) {
    const sources = genome.sources || [];
    const skills = genome.skills || [];
    return e(Card, null,
      e("div", { className: "mm-card-head" },
        e("div", null, e("p", { className: "mm-overline" }, "inputs"), e("h2", null, "What the map is built from")),
        e("span", { className: "mm-hash" }, (genome.state_hash || "").slice(0, 12))
      ),
      e("div", { className: "mm-input-grid" },
        e("div", null,
          e("h3", null, "Memory sources"),
          sources.length ? sources.slice(0, 8).map((s) => e("div", { className: "mm-row", key: s.path },
            e("span", null, s.name), e("code", null, `${s.chars} chars`)
          )) : e("p", { className: "mm-muted" }, "No memory files found")
        ),
        e("div", null,
          e("h3", null, "Skills sampled"),
          skills.length ? skills.slice(0, 8).map((s) => e("div", { className: "mm-row", key: s.path },
            e("span", null, s.name), e("code", null, `${s.chars} chars`)
          )) : e("p", { className: "mm-muted" }, "No skills found")
        )
      )
    );
  }

  function Timeline({ timeline, current, setCurrent }) {
    return e(Card, null,
      e("div", { className: "mm-card-head" },
        e("div", null, e("p", { className: "mm-overline" }, "history"), e("h2", null, "Memory snapshots")),
        e("span", { className: "mm-muted" }, `${timeline.length} snapshots`)
      ),
      timeline.length ? e("div", { className: "mm-timeline" }, timeline.slice().reverse().map((snap) => e("button", {
        key: snap.id,
        className: `mm-snapshot ${current && current.id === snap.id ? "active" : ""}`,
        onClick: () => setCurrent({ ...snap, sources: [], skills: [] })
      },
        e("strong", null, snap.structure && snap.structure.summary ? snap.structure.summary.coverage_label : snap.reason),
        e("span", null, snap.insights && snap.insights.headline ? snap.insights.headline : new Date(snap.created_at).toLocaleString())
      ))) : e("p", { className: "mm-muted" }, "No snapshots yet. Generate one after a meaningful memory change.")
    );
  }

  function MemoryMandalaPage() {
    const [state, setState] = hooks.useState(null);
    const [current, setCurrent] = hooks.useState(null);
    const [loading, setLoading] = hooks.useState(true);
    const [error, setError] = hooks.useState(null);
    const [blooming, setBlooming] = hooks.useState(false);

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

    const bloom = async (force) => {
      setBlooming(true); setError(null);
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
        setBlooming(false);
      }
    };

    if (loading) return e("div", { className: "mm-shell" }, e("div", { className: "mm-loading" }, "loading memory structure…"));
    if (error) return e("div", { className: "mm-shell" }, e(Card, null, e("div", { className: "mm-error" }, error), e(Button, { onClick: load }, "retry")));

    const genome = state && state.genome || current || {};
    const active = current || genome;
    const structure = active.structure || genome.structure || { sections: [], summary: {}, edges: [] };
    const insights = active.insights || genome.insights || {};
    const timeline = state && state.timeline || [];

    return e("div", { className: "mm-shell" },
      e("div", { className: "mm-hero" },
        e("div", null,
          e("p", { className: "mm-overline" }, "memory mandala v0.3"),
          e("h1", null, "Memory Structure"),
          e("p", { className: "mm-subtitle" }, "A functional map of what the agent knows: identity, preferences, projects, skills, safety, and recent learning. Decorative bloom replaced with readable structure.")
        ),
        e("div", { className: "mm-actions" },
          state && state.has_unbloomed_changes && e("span", { className: "mm-badge hot" }, "unmapped changes"),
          e(Button, { onClick: () => bloom(false), disabled: blooming }, blooming ? "mapping…" : "save snapshot"),
          e(Button, { onClick: () => bloom(true), disabled: blooming, className: "secondary" }, "force snapshot")
        )
      ),
      e("div", { className: "mm-top-metrics" },
        e(Metric, { label: "coverage", value: `${Math.round(((structure.summary || {}).coverage || 0) * 100)}%`, note: (structure.summary || {}).coverage_label || "unknown" }),
        e(Metric, { label: "sources", value: (genome.totals || {}).memory_sources || 0, note: "memory files" }),
        e(Metric, { label: "skills", value: (genome.totals || {}).skills || 0, note: "procedures" }),
        e(Metric, { label: "primary gap", value: (structure.summary || {}).primary_gap || "none", note: "next fix", tone: (structure.summary || {}).primary_gap ? "warn" : "ok" })
      ),
      e("div", { className: "mm-layout" },
        e(StructureMap, { structure }),
        e(InsightPanel, { insights, structure })
      ),
      e(SourceTable, { genome }),
      e(Timeline, { timeline, current: active, setCurrent })
    );
  }

  function MemoryMandalaBadge() {
    const [state, setState] = hooks.useState(null);
    hooks.useEffect(() => { fetchJSON(`${API}/state`).then(setState).catch(() => {}); }, []);
    const structure = state && state.genome && state.genome.structure;
    const coverage = structure && structure.summary ? Math.round(structure.summary.coverage * 100) : null;
    return e("a", { className: "mm-header-badge", href: "#/memory-mandala", title: "Memory Structure" },
      e("span", { className: state && state.has_unbloomed_changes ? "pulse" : "" }),
      coverage === null ? "memory map" : `${coverage}% mapped`
    );
  }

  function SlotBanner() {
    return e("div", { className: "mm-slot-banner" },
      e("strong", null, "Memory Structure"),
      e("span", null, "Readable map of identity, preferences, projects, skills, safety, and recent learning.")
    );
  }

  window.__HERMES_PLUGINS__.register("memory-mandala", MemoryMandalaPage);
  if (window.__HERMES_PLUGINS__.registerSlot) {
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "header-right", MemoryMandalaBadge);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "sessions:top", SlotBanner);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "skills:top", SlotBanner);
  }
})();
