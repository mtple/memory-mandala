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

  function hashRand(seed) {
    let x = seed >>> 0;
    return function () {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return ((x >>> 0) / 4294967296);
    };
  }

  function point(cx, cy, r, a) {
    return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
  }

  function MandalaSvg({ snapshot, compact }) {
    const genome = snapshot || {};
    const seed = Number(genome.seed || 1);
    const rand = hashRand(seed);
    const palette = genome.palette || ["#7dd3fc", "#c084fc", "#f0abfc", "#fef3c7"];
    const categories = genome.categories || {};
    const keywords = (genome.keywords || []).slice(0, compact ? 0 : 10);
    const totals = genome.totals || {};
    const signals = genome.signals || {};
    const size = compact ? 220 : 720;
    const cx = size / 2;
    const cy = size / 2;
    const categoryValues = Object.values(categories);
    const rings = 5 + (seed % 5);
    const petals = 10 + (seed % 14);
    const complexity = Number(signals.complexity || 0.5);
    const novelty = Number(signals.novelty || 0.2);

    const ringEls = Array.from({ length: rings }, (_, i) => {
      const radius = compact ? 24 + i * 13 : 78 + i * (36 + complexity * 10);
      return e("circle", {
        key: `ring-${i}`, cx, cy, r: radius, fill: "none",
        stroke: palette[i % palette.length], strokeOpacity: 0.16 + i / (rings * 7),
        strokeWidth: compact ? 0.8 : 1.4, strokeDasharray: i % 2 ? undefined : "2 10"
      });
    });

    const petalEls = Array.from({ length: petals }, (_, i) => {
      const angle = Math.PI * 2 * i / petals + ((seed % 360) * Math.PI / 1800);
      const cat = categoryValues[i % Math.max(1, categoryValues.length)] || 1;
      const length = compact ? 46 + (cat % 9) * 2 : 130 + (cat % 9) * 10 + complexity * 80;
      const width = compact ? 8 + rand() * 8 : 20 + rand() * 18;
      const [x, y] = point(cx, cy, length / 2, angle);
      return e("ellipse", {
        key: `petal-${i}`, cx: x, cy: y, rx: width, ry: length / 2,
        transform: `rotate(${angle * 180 / Math.PI} ${x} ${y})`,
        fill: palette[i % palette.length], fillOpacity: compact ? 0.13 : 0.08,
        stroke: palette[i % palette.length], strokeOpacity: 0.46, strokeWidth: compact ? 0.7 : 1,
        className: "mm-glow"
      });
    });

    const nodeCount = Math.max(8, Math.min(compact ? 16 : 28, (genome.keywords || []).length + Math.floor((totals.skills || 0) / 2) + 8));
    const nodes = Array.from({ length: nodeCount }, (_, i) => {
      const angle = Math.PI * 2 * i / nodeCount + (seed % 99) / 99;
      const radius = compact ? 70 + rand() * 22 : 170 + rand() * 48 + novelty * 70;
      return point(cx, cy, radius, angle);
    });
    const chordEls = nodes.map(([x, y], i) => {
      const [x2, y2] = nodes[(i * 5 + seed) % nodeCount];
      return e("line", { key: `chord-${i}`, x1: x, y1: y, x2, y2, stroke: palette[(i + 1) % palette.length], strokeOpacity: 0.18, strokeWidth: compact ? 0.6 : 1 });
    });
    const nodeEls = nodes.map(([x, y], i) => e("circle", {
      key: `node-${i}`, cx: x, cy: y, r: compact ? 1.8 + (i % 3) : 3 + (i % 5), fill: palette[i % palette.length], fillOpacity: 0.86, className: "mm-glow"
    }));

    const keywordEls = keywords.slice(0, 8).map((kw, i) => {
      const [x, y] = point(cx, cy, 308, Math.PI * 2 * i / Math.max(1, Math.min(8, keywords.length)) - Math.PI / 2);
      return e("text", { key: `kw-${kw}`, x, y, textAnchor: "middle", className: "mm-keyword" }, kw);
    });

    return e("svg", { className: `memory-mandala-art ${compact ? "compact" : ""}`, viewBox: `0 0 ${size} ${size}`, role: "img" },
      e("defs", null,
        e("radialGradient", { id: compact ? "mm-bg-small" : "mm-bg", cx: "50%", cy: "50%" },
          e("stop", { offset: "0%", stopColor: palette[1], stopOpacity: "0.22" }),
          e("stop", { offset: "100%", stopColor: "#020617", stopOpacity: "1" })
        )
      ),
      e("rect", { width: size, height: size, fill: `url(#${compact ? "mm-bg-small" : "mm-bg"})` }),
      ringEls, petalEls, chordEls, nodeEls,
      !compact && e("circle", { cx, cy, r: 52, fill: "#020617", fillOpacity: 0.72, stroke: palette[0], strokeOpacity: 0.8, strokeWidth: 1.5 }),
      !compact && e("text", { x: cx, y: cy - 4, textAnchor: "middle", className: "mm-center-main" }, `${totals.memory_sources || 0} sources`),
      !compact && e("text", { x: cx, y: cy + 18, textAnchor: "middle", className: "mm-center-sub" }, `${totals.skills || 0} skills · ${totals.recent_sessions || 0} sessions`),
      keywordEls
    );
  }

  function Stat({ label, value, tone }) {
    return e("div", { className: "mm-stat" },
      e("span", { className: "mm-stat-label" }, label),
      e("strong", { className: tone ? `mm-${tone}` : "" }, value)
    );
  }

  function Card(props) {
    const Comp = C.Card || "div";
    return e(Comp, { className: `mm-card ${props.className || ""}` }, props.children);
  }

  function Button(props) {
    const Comp = C.Button || "button";
    return e(Comp, { ...props, className: `mm-button ${props.className || ""}` }, props.children);
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

    if (loading) return e("div", { className: "mm-shell" }, e("div", { className: "mm-loading" }, "germinating memory mandala…"));
    if (error) return e("div", { className: "mm-shell" }, e(Card, null, e("div", { className: "mm-error" }, error), e(Button, { onClick: load }, "retry")));

    const genome = state && state.genome || current || {};
    const timeline = state && state.timeline || [];
    const categories = genome.categories || {};
    const totals = genome.totals || {};
    const signals = genome.signals || {};

    return e("div", { className: "mm-shell" },
      e("div", { className: "mm-hero" },
        e("div", null,
          e("p", { className: "mm-eyebrow" }, "living agent portrait"),
          e("h1", null, "Memory Mandala"),
          e("p", { className: "mm-subtitle" }, "A deterministic artwork grown from Hermes memory, skills, and recent context. Each bloom becomes a local timeline snapshot.")
        ),
        e("div", { className: "mm-actions" },
          state && state.has_unbloomed_changes && e("span", { className: "mm-badge hot" }, "unbloomed changes"),
          e(Button, { onClick: () => bloom(false), disabled: blooming }, blooming ? "blooming…" : "grow mandala"),
          e(Button, { onClick: () => bloom(true), disabled: blooming, className: "secondary" }, "force bloom")
        )
      ),
      e("div", { className: "mm-grid" },
        e(Card, { className: "mm-art-card" },
          e(MandalaSvg, { snapshot: current || genome }),
          e("div", { className: "mm-caption" },
            e("span", null, (current && current.state_hash || genome.state_hash || "").slice(0, 12)),
            e("span", null, current && current.reason || "current memory state")
          )
        ),
        e("div", { className: "mm-side" },
          e(Card, null,
            e("h2", null, "Memory DNA"),
            e("div", { className: "mm-stats" },
              e(Stat, { label: "sources", value: totals.memory_sources || 0 }),
              e(Stat, { label: "skills", value: totals.skills || 0 }),
              e(Stat, { label: "chars", value: (totals.memory_chars || 0).toLocaleString() }),
              e(Stat, { label: "sessions", value: totals.recent_sessions || 0 })
            ),
            e("div", { className: "mm-bars" }, Object.entries(categories).map(([key, value]) => e("div", { className: "mm-bar", key },
              e("span", null, key),
              e("i", { style: { width: `${Math.min(100, 10 + Number(value) * 9)}%` } }),
              e("b", null, value)
            )))
          ),
          e(Card, null,
            e("h2", null, "Signals"),
            e("div", { className: "mm-stats" },
              e(Stat, { label: "complexity", value: Math.round((signals.complexity || 0) * 100) + "%", tone: "cyan" }),
              e(Stat, { label: "stability", value: Math.round((signals.stability || 0) * 100) + "%", tone: "violet" }),
              e(Stat, { label: "novelty", value: Math.round((signals.novelty || 0) * 100) + "%", tone: "pink" })
            ),
            e("div", { className: "mm-keywords" }, (genome.keywords || []).slice(0, 16).map((kw) => e("span", { key: kw }, kw)))
          )
        )
      ),
      e(Card, { className: "mm-timeline-card" },
        e("div", { className: "mm-section-head" }, e("h2", null, "Bloom Timeline"), e("span", null, `${timeline.length} snapshots`)),
        timeline.length ? e("div", { className: "mm-timeline" }, timeline.slice().reverse().map((snap) => e("button", {
          key: snap.id, className: `mm-snapshot ${current && current.id === snap.id ? "active" : ""}`,
          onClick: async () => {
            // Timeline summaries are enough for thumbnail rendering; current full view remains latest.
            setCurrent({ ...snap, sources: [], skills: [] });
          }
        },
          e(MandalaSvg, { snapshot: snap, compact: true }),
          e("strong", null, snap.reason),
          e("span", null, new Date(snap.created_at).toLocaleString())
        ))) : e("p", { className: "mm-muted" }, "No blooms yet. Press grow mandala to create the first snapshot.")
      )
    );
  }

  function MemoryMandalaBadge() {
    const [state, setState] = hooks.useState(null);
    hooks.useEffect(() => { fetchJSON(`${API}/state`).then(setState).catch(() => {}); }, []);
    const genome = state && state.genome;
    return e("a", { className: "mm-header-badge", href: "#/memory-mandala", title: "Memory Mandala" },
      e("span", { className: state && state.has_unbloomed_changes ? "pulse" : "" }),
      genome ? `${(genome.state_hash || "").slice(0, 6)} bloom` : "mandala"
    );
  }

  function SlotBanner() {
    return e("div", { className: "mm-slot-banner" },
      e("strong", null, "Memory Mandala"),
      e("span", null, "Your memory artwork evolves when context meaningfully changes.")
    );
  }

  window.__HERMES_PLUGINS__.register("memory-mandala", MemoryMandalaPage);
  if (window.__HERMES_PLUGINS__.registerSlot) {
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "header-right", MemoryMandalaBadge);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "sessions:top", SlotBanner);
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "skills:top", SlotBanner);
  }
})();
