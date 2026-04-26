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
  function normAngle(a) {
    while (a < 0) a += Math.PI * 2;
    while (a >= Math.PI * 2) a -= Math.PI * 2;
    return a;
  }
  function routedArcPath(cx, cy, a, b, lane) {
    const a0 = normAngle(a.angle), a1 = normAngle(b.angle);
    let delta = a1 - a0;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    const sweep = delta >= 0 ? 1 : 0;
    const large = Math.abs(delta) > Math.PI ? 1 : 0;
    const start = polar(cx, cy, lane, a.angle);
    const end = polar(cx, cy, lane, b.angle);
    return `M ${a.x.toFixed(1)} ${a.y.toFixed(1)} L ${start[0].toFixed(1)} ${start[1].toFixed(1)} A ${lane} ${lane} 0 ${large} ${sweep} ${end[0].toFixed(1)} ${end[1].toFixed(1)} L ${b.x.toFixed(1)} ${b.y.toFixed(1)}`;
  }
  function rosettePoints(cx, cy, r, sides, phase) {
    return Array.from({ length: sides }, (_, j) => {
      const a = -Math.PI / 2 + Math.PI * 2 * j / sides + phase;
      const p = polar(cx, cy, r, a);
      return `${p[0].toFixed(1)},${p[1].toFixed(1)}`;
    }).join(" ");
  }
  const KINDS = ["identity", "preferences", "projects", "skills", "safety", "recent"];
  const KIND_GUIDE = {
    identity: "who tortOS is",
    preferences: "matt's durable preferences",
    projects: "active operating context",
    skills: "usable procedures ranked by usage",
    safety: "hard constraints",
    recent: "fresh evidence"
  };
  const LAYERS = [
    { r: 64, label: "center", detail: "strong evidence links" },
    { r: 130, label: "hub ring", detail: "shared terms" },
    { r: 240, label: "fact field", detail: "individual remembered facts" },
    { r: 455, label: "sector rim", detail: "memory categories" }
  ];
  function kindIndex(kind) { return Math.max(0, KINDS.indexOf(kind)); }
  function sectorMid(kind) { return -Math.PI / 2 + (Math.PI * 2 * (kindIndex(kind) + .5) / KINDS.length); }
  function sectorStart(kind) { return -Math.PI / 2 + (Math.PI * 2 * kindIndex(kind) / KINDS.length); }
  function importance(node) {
    return (node.weight || 1) + ((node.terms || []).length * .55) + (node.kind === "skills" ? (node.usage_heat || 0) * 5 : 0);
  }
  function sourceLabel(node) {
    const raw = (node.text || node.title || node.source || "memory").replace(/[*_`]/g, "").replace(/\s+/g, " ").trim();
    const source = String(node.source || node.title || "").toLowerCase();
    if (/session[:_ -]*session[_-]?\d/i.test(raw) || /session[:_ -]*session[_-]?\d/i.test(source)) return "recent session memory";
    const cleaned = raw.replace(/^(what works on farcaster \([^)]*\):\s*)/i, "");
    return short(cleaned || node.source || "memory", 34);
  }
  function sectorCounts(layout) { return Object.fromEntries(KINDS.map((k) => [k, (layout.byKind[k] || []).length])); }

  function graphLayout(graph) {
    const nodes = graph.nodes || [];
    const links = graph.connections || [];
    const hubs = graph.hubs || [];
    const cx = 500, cy = 500;
    const byKind = Object.fromEntries(KINDS.map((k) => [k, []]));
    nodes.forEach((n) => (byKind[n.kind] || byKind.projects).push(n));
    const pos = {};
    KINDS.forEach((kind) => {
      const group = (byKind[kind] || []).sort((a, b) => importance(b) - importance(a));
      const start = sectorStart(kind) + 0.13;
      const span = (Math.PI * 2 / KINDS.length) - 0.26;
      const lanes = [204, 268, 332, 396];
      group.forEach((node, i) => {
        const t = (i + .5) / Math.max(1, group.length);
        const angle = start + span * t;
        const lane = lanes[i % lanes.length];
        const priorityPull = Math.max(0, 1 - i / Math.max(1, group.length)) * 26;
        const usage = node.kind === "skills" ? Math.min(1, (node.usage_heat || 0)) * 34 : 0;
        const r = lane + priorityPull + usage;
        const [x, y] = polar(cx, cy, r, angle);
        pos[node.id] = { x, y, angle, r, node, rank: i + 1, label: i < 2 };
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
    // Match the SVG viewBox projection exactly: preserveAspectRatio centers
    // a 1000x1000 square inside the same CSS viewport. Any extra scale or
    // y-bias makes the canvas mandala drift against the SVG hit layer.
    const size = Math.min(rect.width, rect.height);
    const cx = rect.width / 2;
    const cy = rect.height / 2;
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

    // Connections are intentionally quiet here. The SVG layer draws routed, readable
    // relationship paths; the canvas stays as geometry/context, not spaghetti.
    layout.links.slice(0, 6).forEach((conn, i) => {
      const a = layout.pos[conn.from], b = layout.pos[conn.to];
      if (!a || !b) return;
      const alive = !activeTerms.length || conn.shared_terms.some((t) => activeTerms.includes(t));
      const hue = HUES[conn.from_kind] || 280;
      const lane = toR(122 + (i % 4) * 34);
      const aa = Math.atan2(a.y - 500, a.x - 500);
      const bb = Math.atan2(b.y - 500, b.x - 500);
      const start = [cx + Math.cos(aa) * lane, cy + Math.sin(aa) * lane];
      const end = [cx + Math.cos(bb) * lane, cy + Math.sin(bb) * lane];
      ctx.beginPath();
      ctx.arc(cx, cy, lane, aa, bb, false);
      ctx.strokeStyle = hsla(hue, 92, alive ? 68 : 42, alive ? .16 : .035);
      ctx.lineWidth = alive ? 1.5 : .7;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(toX(a.x), toY(a.y)); ctx.lineTo(start[0], start[1]);
      ctx.moveTo(end[0], end[1]); ctx.lineTo(toX(b.x), toY(b.y));
      ctx.strokeStyle = hsla(hue, 92, 68, alive ? .11 : .025);
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
    ctx.fillText("core", 0, -toR(2));
    ctx.font = `${Math.max(9, toR(11))}px ui-monospace, monospace`;
    ctx.fillStyle = "rgba(255,255,255,.58)";
    ctx.fillText("graph", 0, toR(21));
    ctx.restore();
  }


  function matchesNode(node, kindFilter, query, termFocus) {
    const q = (query || "").trim().toLowerCase();
    const kindOk = !kindFilter || node.kind === kindFilter;
    const termOk = !termFocus || (node.terms || []).includes(termFocus);
    if (!kindOk || !termOk) return false;
    if (!q) return true;
    const haystack = [node.kind, KIND[node.kind]?.label, KIND_GUIDE[node.kind], node.source, node.text, node.source_path, ...(node.terms || [])].join(" ").toLowerCase();
    return haystack.includes(q);
  }
  function connectionVisible(conn, visibleIds) {
    return visibleIds.has(conn.from) && visibleIds.has(conn.to);
  }
  function nodeItemFromRail(node) {
    return { type: "memory fact", data: { ...node, title: sourceLabel(node), meta: (node.terms || []).join(", "), source_path: node.source_path }, x: window.innerWidth - 520, y: 120 };
  }
  function rankedTerms(nodes, limit) {
    const counts = new Map();
    (nodes || []).forEach((n) => (n.terms || []).forEach((t) => counts.set(t, (counts.get(t) || 0) + 1)));
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([term, count]) => ({ term, count }));
  }
  function topFacts(nodes, n) {
    return (nodes || []).slice().sort((a, b) => importance(b) - importance(a)).slice(0, n);
  }
  function DataWorkbench({ graph, layout, counts, totalNodes, kindFilter, setKindFilter, query, setQuery, termFocus, clearTerm, openTerm, pinNode, pinConnection, pinSector }) {
    const visibleNodes = (graph.nodes || []).filter((n) => matchesNode(n, kindFilter, query, termFocus)).sort((a, b) => importance(b) - importance(a));
    const visibleIds = new Set(visibleNodes.map((n) => n.id));
    const visibleLinks = (graph.connections || []).filter((c) => connectionVisible(c, visibleIds)).slice(0, 6);
    const topTerms = (graph.hubs || []).slice(0, 12);
    return e("aside", { className: "mm-workbench", "aria-label": "memory data workbench" },
      e("div", { className: "mm-workbench-head" },
        e("p", null, "data workbench"),
        e("strong", null, kindFilter ? `${KIND[kindFilter].label} focus` : (termFocus ? `${termFocus} focus` : "explore graph"))
      ),
      e("label", { className: "mm-search" },
        e("span", null, "search facts"),
        e("input", { value: query, placeholder: "try farcaster, posts, safety…", onChange: (evt) => setQuery(evt.target.value) })
      ),
      e("div", { className: "mm-filter-row" },
        e("button", { className: !kindFilter ? "active" : "", onClick: () => setKindFilter(null) }, "all memory"),
        KINDS.map((kind) => e("button", { key: kind, className: `${kind} ${kindFilter === kind ? "active" : ""}`, onClick: () => { setKindFilter(kind); pinSector(kind); } }, KIND[kind].label))
      ),
      termFocus ? e("div", { className: "mm-focus-strip" },
        e("span", null, "term focus"), e("button", { onClick: clearTerm }, termFocus, " ×")
      ) : null,
      e("section", { className: "mm-work-section" },
        e("div", { className: "mm-section-title" }, e("span", null, "most useful facts"), e("small", null, "click opens source detail")),
        visibleNodes.slice(0, 7).map((node) => e("button", { key: node.id, className: `mm-fact-row ${node.kind}`, onClick: () => pinNode(node) },
          e("span", { className: "mm-row-kind" }, KIND[node.kind]?.short || node.kind),
          e("span", { className: "mm-row-main" }, sourceLabel(node), e("small", null, short(node.text, 154)))
        )),
        visibleNodes.length === 0 ? e("p", { className: "mm-no-results" }, "no facts match the current filters") : null
      ),
      e("section", { className: "mm-work-section compact" },
        e("div", { className: "mm-section-title" }, e("span", null, "strong links"), e("small", null, "2+ shared terms only")),
        visibleLinks.map((conn) => e("button", { key: conn.id, className: "mm-link-row", onClick: () => pinConnection(conn) },
          e("span", null, conn.shared_terms.join(" + ")),
          e("small", null, `${short(conn.from_label, 34)} ↔ ${short(conn.to_label, 34)}`)
        ))
      ),
      e("section", { className: "mm-work-section compact" },
        e("div", { className: "mm-section-title" }, e("span", null, "term hubs"), e("small", null, "click to filter")),
        e("div", { className: "mm-term-grid" }, topTerms.map((hub) => e("button", { key: hub.term, onClick: () => { setSelected(hubItem(hub, { clientX: 0, clientY: 0 })); openTerm(hub.term); } }, hub.term)))
      )
    );
  }

  function detailTitle(item) {
    const data = item && (item.data || item);
    if (!data) return "memory graph";
    return data.title || data.source || data.from_label || data.term || data.kind || "memory detail";
  }
  function detailKind(item) {
    if (!item) return "overview";
    return item.type || (item.data && item.data.kind) || "memory";
  }
  function DynamicInsightPane({ detail, graph, layout, structure, state, saving, save, onOpenTerm, onSelectNode, onSelectConnection, onSelectSector, clearFilters }) {
    const data = detail && (detail.data || detail);
    const kind = data && data.kind;
    const itemTerms = keyTerms(terms(data), 12);
    const related = data && itemTerms.length ? (graph.nodes || []).filter((n) => n.id !== data.id && (n.terms || []).some((t) => itemTerms.includes(t))).slice(0, 6) : [];
    const evidence = (data && data.evidence) || [];
    const title = data ? detailTitle(detail) : "overview";
    const mode = data ? detailKind(detail) : "overview";
    const allNodes = graph.nodes || [];
    const allLinks = graph.connections || [];
    const topTerms = (structure.summary && structure.summary.strongest_terms || []).slice(0, 8);
    const topNodes = topFacts(allNodes, 5);
    const nearbyLinks = data && data.id ? allLinks.filter((c) => c.from === data.id || c.to === data.id).slice(0, 5) : [];
    return e("div", { className: `mm-corner mm-read-guide mm-dynamic-pane ${kind || "overview"}`, "data-mode": mode },
      e("p", null, "live detail"),
      e("div", { className: "mm-dynamic-head" },
        e("span", { className: `mm-dynamic-kind ${kind || "overview"}` }, mode),
        e("h2", null, short(title, 74)),
        data && data.meta ? e("small", null, data.meta) : e("small", null, "updates as you move across the mandala")
      ),
      data && data.text ? e("p", { className: "mm-dynamic-text" }, data.text) : e("p", { className: "mm-dynamic-text" }, "hover or click any glyph, sector, hub, or link to re-shape this pane around real evidence."),
      itemTerms.length ? e("section", { className: "mm-dynamic-section" },
        e("div", { className: "mm-section-title" }, e("span", null, "action chips")),
        e("div", { className: "mm-term-grid" }, itemTerms.map((t) => e("button", { key: t, onClick: () => onOpenTerm(t) }, t)))
      ) : e("section", { className: "mm-dynamic-section" },
        e("div", { className: "mm-section-title" }, e("span", null, "strong terms")),
        e("div", { className: "mm-term-grid" }, topTerms.map((t) => e("button", { key: t, onClick: () => onOpenTerm(t) }, t)))
      ),
      evidence.length ? e("section", { className: "mm-dynamic-section evidence rows" },
        e("div", { className: "mm-section-title" }, e("span", null, "evidence rows")),
        evidence.slice(0, 6).map((ev, i) => e("button", { key: i, className: "mm-dynamic-row", onClick: () => onOpenTerm(itemTerms[0] || "") }, short(ev, 150)))
      ) : nearbyLinks.length ? e("section", { className: "mm-dynamic-section evidence rows" },
        e("div", { className: "mm-section-title" }, e("span", null, "nearby links")),
        nearbyLinks.map((conn) => e("button", { key: conn.id, className: "mm-dynamic-row", onClick: () => onSelectConnection(conn) },
          e("strong", null, conn.shared_terms.join(" + ")), e("small", null, `${short(conn.from_label, 38)} ↔ ${short(conn.to_label, 38)}`)
        ))
      ) : e("section", { className: "mm-dynamic-section evidence rows" },
        e("div", { className: "mm-section-title" }, e("span", null, "evidence rows")),
        topNodes.map((node) => e("button", { key: node.id, className: "mm-dynamic-row", onClick: () => onSelectNode(node) },
          e("strong", null, sourceLabel(node)), e("small", null, short(node.text, 120))
        ))
      ),
      related.length ? e("section", { className: "mm-dynamic-section" },
        e("div", { className: "mm-section-title" }, e("span", null, "connected facts")),
        related.map((node) => e("button", { key: node.id, className: "mm-dynamic-row", onClick: () => onSelectNode(node) },
          e("strong", null, sourceLabel(node)), e("small", null, short(node.text, 126))
        ))
      ) : null,
      e("section", { className: "mm-dynamic-section compact" },
        e("div", { className: "mm-section-title" }, e("span", null, "jump sectors")),
        e("div", { className: "mm-sector-key" }, KINDS.map((k) => e("button", { key: k, className: k, onClick: () => onSelectSector(k) }, e("i", null), e("span", null, KIND[k].label))))
      ),
      e("div", { className: "mm-system-controls" },
        e("p", null, "system controls"),
        state && state.has_unbloomed_changes ? e("span", { className: "mm-live" }, "memory changed") : e("span", null, "map is current"),
        e("button", { onClick: () => save(true), disabled: saving }, saving ? "rebuilding…" : "rebuild memory map"),
        e("button", { onClick: clearFilters }, "reset view")
      )
    );
  }

  function FullscreenMandala({ structure, save, saving, state }) {
    const graph = (structure && structure.memory_graph) || { nodes: [], connections: [], hubs: [] };
    const layout = graphLayout(graph);
    const [hover, setHover] = hooks.useState(null);
    const [selected, setSelected] = hooks.useState(null);
    const [termFocus, setTermFocus] = hooks.useState(null);
    const [kindFilter, setKindFilter] = hooks.useState(null);
    const [query, setQuery] = hooks.useState("");
    const canvasRef = hooks.useRef(null);
    const active = hover || selected;
    const activeTerms = termFocus ? [termFocus] : (active ? terms(active.data) : []);
    const hasFocus = !!(termFocus || hover || kindFilter || query);
    const activeHas = (node) => activeTerms && activeTerms.some((t) => (node.terms || []).includes(t));
    const counts = sectorCounts(layout);
    const totalNodes = Object.values(counts).reduce((a, b) => a + b, 0);
    const visibleNodes = new Set((graph.nodes || []).filter((n) => matchesNode(n, kindFilter, query, termFocus)).map((n) => n.id));
    const nodeVisible = (node) => visibleNodes.has(node.id);
    const linkVisible = (conn) => visibleNodes.has(conn.from) && visibleNodes.has(conn.to);
    const focusNodes = (graph.nodes || []).filter((n) => nodeVisible(n));
    const focusTerms = rankedTerms(focusNodes, kindFilter ? 14 : 8);
    const focusTitle = kindFilter ? KIND[kindFilter].label : (termFocus ? termFocus : (query ? `search: ${query}` : "all memory"));

    hooks.useEffect(() => {
      const draw = () => drawP5Mandala(canvasRef.current, layout, activeTerms, structure.summary || {});
      draw();
      window.addEventListener("resize", draw);
      return () => window.removeEventListener("resize", draw);
    }, [structure, termFocus, hover && hover.data && hover.data.id]);

    const openTerm = (term) => {
      setTermFocus(term);
    };

    const nodeItem = (node, evt) => ({
      type: "memory fact",
      data: { ...node, title: sourceLabel(node), meta: (node.terms || []).join(", "), source_path: node.source_path },
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
      data: { title: hub.term, text: (graph.nodes || []).filter((n) => (n.terms || []).includes(hub.term)).map((n) => n.text).join(" | "), meta: "term hub", terms: [hub.term] },
      x: evt.clientX,
      y: evt.clientY
    });
    const pinNode = (node) => { setSelected({ type: "memory fact", data: { ...node, title: sourceLabel(node), meta: (node.terms || []).join(", "), source_path: node.source_path } }); const first = (node.terms || [])[0]; if (first) setTermFocus(first); };
    const pinConnection = (conn) => { setSelected({ type: "connection", data: { ...conn, title: conn.shared_terms.join(" + "), text: `${conn.from_label} ↔ ${conn.to_label}`, meta: conn.reason } }); const first = (conn.shared_terms || [])[0]; if (first) setTermFocus(first); };
    const sectorData = (kind) => {
      const nodes = (layout.byKind[kind] || []).slice();
      const terms = rankedTerms(nodes, 10);
      return {
        kind,
        title: KIND[kind].label,
        text: `${KIND_GUIDE[kind]}. Top terms: ${terms.map((t) => t.term).join(", ") || "none"}.`,
        meta: "source-backed sector",
        terms: terms.map((t) => t.term),
        evidence: topFacts(nodes, 8).map((n) => n.text)
      };
    };
    const pinSector = (kind) => { setKindFilter(kind); setSelected({ type: "sector", data: sectorData(kind) }); };
    const clearFilters = () => { setKindFilter(null); setQuery(""); setTermFocus(null); setSelected(null); setHover(null); };

    return e("div", { className: "mm-fullscreen", onMouseLeave: () => setHover(null) },
      (kindFilter || query || termFocus) ? e("div", { className: "mm-corner mm-top-right" },
        e("button", { onClick: clearFilters }, "clear filters")
      ) : null,
      e("section", { className: "mm-left-pane", "aria-label": "memory control pane" },
        e("div", { className: "mm-pane-intro" },
          e("p", null, "memory mandala"),
          e("h1", null, "memory graph")
        ),
        e(DataWorkbench, { graph, layout, counts, totalNodes, kindFilter, setKindFilter, query, setQuery, termFocus, clearTerm: () => setTermFocus(null), openTerm, pinNode, pinConnection, pinSector }),
        e(DynamicInsightPane, { detail: active, graph, layout, structure, state, saving, save, onOpenTerm: openTerm, onSelectNode: pinNode, onSelectConnection: pinConnection, onSelectSector: pinSector, clearFilters })
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
          return e("g", { key: `sector-${kind}`, className: `mm-sector ${kind}`, onMouseMove: (evt) => setHover({ type: "sector", data: sectorData(kind), x: evt.clientX, y: evt.clientY }), onClick: () => { setKindFilter(kind); pinSector(kind); } },
            e("path", { d: annularPath(layout.cx, layout.cy, 112, 455, a0, a1), style: { fill: color(kind), stroke: color(kind) } }),
            e("line", { className: "mm-sector-divider", x1: polar(layout.cx, layout.cy, 102, a0)[0], y1: polar(layout.cx, layout.cy, 102, a0)[1], x2: polar(layout.cx, layout.cy, 474, a0)[0], y2: polar(layout.cx, layout.cy, 474, a0)[1], style: { stroke: color(kind) } }),
            e("g", { className: "mm-sector-label", transform: `translate(${polar(layout.cx, layout.cy, 470, sectorMid(kind))[0]} ${polar(layout.cx, layout.cy, 470, sectorMid(kind))[1]})` },
              e("text", { y: -7, textAnchor: "middle" }, KIND[kind].label),
              e("text", { y: 10, textAnchor: "middle", className: "mm-sector-count" }, "sector")
            )
          );
        }),
        KINDS.flatMap((kind) => Array.from({ length: Math.max(2, Math.min(6, (layout.byKind[kind] || []).length || 0)) }, (_, j) => {
          const total = Math.max(2, Math.min(6, (layout.byKind[kind] || []).length || 0));
          const a = sectorStart(kind) + (Math.PI * 2 / KINDS.length) * ((j + .5) / total);
          const inner = polar(layout.cx, layout.cy, 118 + j * 21, a);
          return e("ellipse", { key: `petal-${kind}-${j}`, className: `mm-data-petal ${kind}`, cx: inner[0], cy: inner[1], rx: 9 + j * .9, ry: 38 + j * 2.7, transform: `rotate(${a * 180 / Math.PI} ${inner[0]} ${inner[1]})`, style: { fill: color(kind), stroke: color(kind) } });
        })),
        [96, 144, 192, 288, 384, 432].map((r, i) => e("g", { key: `poly-${r}`, className: "mm-sacred-set" },
          e("polygon", { className: "mm-sacred-poly", points: rosettePoints(layout.cx, layout.cy, r, 6, i * .08) }),
          e("polygon", { className: "mm-sacred-poly ghost", points: rosettePoints(layout.cx, layout.cy, r * .86, 6, Math.PI / 6 + i * .08) })
        )),
        LAYERS.map((layer) => e("g", { key: `layer-${layer.label}`, className: "mm-layer-ring" },
          e("circle", { cx: layout.cx, cy: layout.cy, r: layer.r }),
          e("text", { x: layout.cx + layer.r + 10, y: layout.cy - 7, textAnchor: "start" }, layer.label)
        )),
        focusTerms.map((termInfo, i) => {
          const base = kindFilter ? sectorMid(kindFilter) : (-Math.PI / 2 + Math.PI * 2 * i / Math.max(1, focusTerms.length));
          const spread = kindFilter ? (i - (focusTerms.length - 1) / 2) * .045 : 0;
          const lane = 150 + (i % 4) * 48;
          const a = base + spread;
          const p = polar(layout.cx, layout.cy, lane, a);
          const related = focusNodes.filter((n) => (n.terms || []).includes(termInfo.term)).slice(0, 8);
          return e("g", { key: `focus-${termInfo.term}`, className: `mm-focus-hub ${kindFilter || termFocus || query ? "active" : "ambient"}`, onMouseMove: (evt) => setHover({ type: "term hub", data: { title: termInfo.term, text: `Visible facts use this term in ${focusTitle}.`, meta: `term hub · ${focusTitle}`, terms: [termInfo.term], evidence: related.map((n) => n.text) }, x: evt.clientX, y: evt.clientY }), onClick: () => { setSelected({ type: "term hub", data: { title: termInfo.term, text: `Visible facts use this term in ${focusTitle}.`, meta: `term hub · ${focusTitle}`, terms: [termInfo.term], evidence: related.map((n) => n.text) } }); openTerm(termInfo.term); } },
            related.map((node) => {
              const q = layout.pos[node.id];
              if (!q) return null;
              return e("path", { key: `${termInfo.term}-${node.id}`, d: `M ${p[0].toFixed(1)} ${p[1].toFixed(1)} L ${q.x.toFixed(1)} ${q.y.toFixed(1)}` });
            }),
            e("circle", { cx: p[0], cy: p[1], r: 8 + Math.min(10, termInfo.count * 1.6) }),
            e("text", { x: p[0], y: p[1] - 14, textAnchor: "middle" }, termInfo.term),
            e("text", { className: "count", x: p[0], y: p[1] + 4, textAnchor: "middle" }, "hub")
          );
        }),
        layout.hubs.slice(0, 8).map((hub, i) => {
          const r = 78 + i * 44;
          return e("g", { key: `hub-${hub.term}`, className: "mm-hub-orbit", onMouseMove: (evt) => setHover(hubItem(hub, evt)), onClick: () => { setSelected(hubItem(hub, { clientX: 0, clientY: 0 })); openTerm(hub.term); } },
            e("circle", { cx: layout.cx, cy: layout.cy, r, style: { stroke: color(["identity", "preferences", "projects", "skills", "safety", "recent"][i % 6]) } }),
            e("text", { x: layout.cx, y: layout.cy - r - 8, textAnchor: "middle" }, hub.term)
          );
        }),
        layout.links.map((conn, i) => {
          const a = layout.pos[conn.from], b = layout.pos[conn.to];
          if (!a || !b) return null;
          const alive = (!activeTerms.length || conn.shared_terms.some((t) => activeTerms.includes(t))) && linkVisible(conn);
          const lane = 126 + (i % 5) * 32;
          const path = routedArcPath(layout.cx, layout.cy, a, b, lane);
          const show = hasFocus ? alive : i < 10;
          return e("g", { key: conn.id, className: `mm-link routed ${show ? "alive" : "dim"} ${linkVisible(conn) ? "" : "filtered"}`, onMouseMove: (evt) => setHover(connItem(conn, evt)), onClick: () => pinConnection(conn) },
            e("path", { className: "mm-link-hit", d: path, strokeWidth: 12 }),
            e("path", { className: "mm-link-line", d: path, strokeWidth: Math.min(3.2, .8 + conn.weight * .38) }),
            e("circle", { cx: polar(layout.cx, layout.cy, lane, (a.angle + b.angle) / 2)[0], cy: polar(layout.cx, layout.cy, lane, (a.angle + b.angle) / 2)[1], r: 2 + Math.min(4, conn.shared_terms.length) })
          );
        }),
        layout.nodes.map((node, i) => {
          const p = layout.pos[node.id];
          const alive = (!activeTerms.length || activeHas(node)) && nodeVisible(node);
          const filtered = !nodeVisible(node);
          const size = 9 + Math.min(22, (node.weight || 1) * 2);
          const petals = Math.max(3, Math.min(9, (node.terms || []).length));
          return e("g", { key: node.id, className: `mm-memory-glyph ${node.kind} ${alive ? "alive" : "dim"} ${filtered ? "filtered" : ""}`, onMouseMove: (evt) => setHover(nodeItem(node, evt)), onClick: () => pinNode(node), tabIndex: 0, role: "button", "aria-label": `${sourceLabel(node)}: ${node.text}` },
            Array.from({ length: petals }, (_, j) => {
              const a = p.angle + Math.PI * 2 * j / petals;
              const q = polar(p.x, p.y, size * 1.7, a);
              return e("ellipse", { key: j, cx: q[0], cy: q[1], rx: size * .42, ry: size * 1.18, transform: `rotate(${a * 180 / Math.PI} ${q[0]} ${q[1]})`, style: { fill: color(node.kind) } });
            }),
            e("circle", { cx: p.x, cy: p.y, r: size, style: { fill: color(node.kind) } }),
            e("text", { x: p.x, y: p.y + 4, textAnchor: "middle" }, KIND[node.kind]?.short || "mem"),
            p.label && e("text", { className: "mm-node-label", x: p.x + (Math.cos(p.angle) > 0 ? size + 18 : -size - 18), y: p.y + (Math.sin(p.angle) * 10), textAnchor: Math.cos(p.angle) > 0 ? "start" : "end" }, sourceLabel(node))
          );
        }),
        e("g", { className: "mm-center-sigil", onMouseMove: (evt) => setHover({ type: "overview", data: { title: "evidence-only graph", text: "Source-backed facts are connected only when they share strong concrete terms. Weak one-term links are hidden.", meta: (structure.summary.strongest_terms || []).join(", ") }, x: evt.clientX, y: evt.clientY }), onClick: clearFilters },
          e("circle", { cx: layout.cx, cy: layout.cy, r: 64 }),
          e("circle", { cx: layout.cx, cy: layout.cy, r: 42 }),
          e("text", { x: layout.cx, y: layout.cy - 2, textAnchor: "middle" }, "core"),
          e("text", { x: layout.cx, y: layout.cy + 18, textAnchor: "middle" }, "graph")
        )
      ),
      graph.nodes && graph.nodes.length ? null : e("div", { className: "mm-empty" }, "no strong memory graph yet")
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
    return e("a", { className: "mm-header-badge", href: "#/memory-mandala", title: "Memory Mandala" }, e("span", null), "memory mandala");
  }

  window.__HERMES_PLUGINS__.register("memory-mandala", MemoryMandalaPage);
  if (window.__HERMES_PLUGINS__.registerSlot) {
    window.__HERMES_PLUGINS__.registerSlot("memory-mandala", "header-right", MemoryMandalaBadge);
  }
})();
