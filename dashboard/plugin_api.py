"""Memory Mandala — Hermes dashboard plugin backend.

This module intentionally keeps the core analysis functions pure and dependency-light so
it can be tested without a running Hermes install. The FastAPI router at the bottom wraps
those functions for the dashboard plugin runtime.
"""

from __future__ import annotations

import hashlib
import html
import json
import math
import os
import re
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

try:  # FastAPI is available inside Hermes, but tests should import without it.
    from fastapi import APIRouter, HTTPException
except Exception:  # pragma: no cover - exercised only outside Hermes dev envs
    class HTTPException(Exception):
        def __init__(self, status_code: int = 500, detail: str = ""):
            super().__init__(detail)
            self.status_code = status_code
            self.detail = detail

    class APIRouter:  # minimal decorator shim for tests
        def get(self, *_args, **_kwargs):
            return lambda fn: fn

        def post(self, *_args, **_kwargs):
            return lambda fn: fn

router = APIRouter()

PLUGIN_NAME = "memory-mandala"
MAX_TEXT_CHARS = 220_000
MAX_TIMELINE = 48
STOPWORDS = {
    "the", "and", "for", "that", "with", "this", "from", "have", "will", "your",
    "user", "agent", "memory", "hermes", "should", "when", "what", "were", "been",
    "into", "their", "there", "about", "which", "would", "could", "than", "then",
    "them", "they", "you", "are", "but", "not", "all", "can", "has", "was", "use",
}
CATEGORY_RULES = {
    "identity": ["identity", "role", "name", "called", "pronouns", "timezone", "founder", "operator"],
    "preferences": ["prefers", "preference", "likes", "wants", "style", "tone", "concise", "format"],
    "projects": ["project", "repo", "repository", "app", "dashboard", "platform", "contract", "plugin"],
    "skills": ["skill", "workflow", "procedure", "steps", "run", "command", "build", "test"],
    "safety": ["never", "secret", "token", "credential", "security", "redact", "ask", "confirm", "safe"],
    "recent": ["today", "yesterday", "recent", "session", "learned", "created", "updated", "fixed"],
}
PALETTES = [
    ["#7dd3fc", "#c084fc", "#f0abfc", "#fef3c7"],
    ["#34d399", "#a7f3d0", "#fbbf24", "#fb7185"],
    ["#60a5fa", "#818cf8", "#f472b6", "#f8fafc"],
    ["#2dd4bf", "#67e8f9", "#a78bfa", "#fde68a"],
    ["#fb923c", "#facc15", "#84cc16", "#22c55e"],
]


def hermes_home() -> Path:
    try:
        from hermes_constants import get_hermes_home  # type: ignore
        return Path(get_hermes_home())
    except Exception:
        return Path(os.environ.get("HERMES_HOME", Path.home() / ".hermes"))


def default_data_dir() -> Path:
    return Path(os.environ.get("MEMORY_MANDALA_DATA", Path(__file__).resolve().parent.parent / "data"))


def _safe_read(path: Path, max_chars: int = 80_000) -> str:
    try:
        if not path.exists() or not path.is_file():
            return ""
        return path.read_text(encoding="utf-8", errors="replace")[:max_chars]
    except Exception:
        return ""


def _stable_json(data: Any) -> str:
    return json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":"))


def _sha(data: str | bytes) -> str:
    if isinstance(data, str):
        data = data.encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def _tokenize(text: str) -> list[str]:
    words = re.findall(r"[A-Za-z][A-Za-z0-9_.-]{2,}", text.lower())
    return [w.strip("._-") for w in words if w not in STOPWORDS and len(w) > 2]


def _extract_keywords(text: str, limit: int = 18) -> list[str]:
    counts = Counter(_tokenize(text))
    return [word for word, _count in counts.most_common(limit)]


def _category_counts(text: str) -> dict[str, int]:
    lowered = text.lower()
    counts: dict[str, int] = {}
    for category, needles in CATEGORY_RULES.items():
        counts[category] = sum(lowered.count(needle) for needle in needles)
    # Ensure every category has some visual presence.
    return counts


def _collect_memory_sources(home: Path) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    candidates = [home / "MEMORY.md", home / "USER.md", home / "AGENTS.md", home / "SOUL.md"]
    memory_dir = home / "memory"
    if memory_dir.exists():
        candidates.extend(sorted(memory_dir.glob("*.md"))[-60:])
        candidates.extend(sorted(memory_dir.glob("*.json"))[-60:])

    seen: set[Path] = set()
    for path in candidates:
        path = path.resolve() if path.exists() else path
        if path in seen:
            continue
        seen.add(path)
        text = _safe_read(path)
        if text:
            sources.append({
                "path": str(path),
                "name": path.name,
                "kind": "daily" if path.parent.name == "memory" else path.stem.lower(),
                "chars": len(text),
                "hash": _sha(text),
                "text": text,
            })
    return sources


def _collect_skills(home: Path) -> list[dict[str, Any]]:
    skills_dir = home / "skills"
    skills: list[dict[str, Any]] = []
    if not skills_dir.exists():
        return skills
    for skill_md in sorted(skills_dir.glob("**/SKILL.md"))[:500]:
        text = _safe_read(skill_md, 12_000)
        name = skill_md.parent.name
        match = re.search(r"^name:\s*([^\n]+)", text, re.M)
        if match:
            name = match.group(1).strip().strip('"\'')
        skills.append({
            "name": name,
            "path": str(skill_md),
            "hash": _sha(text),
            "chars": len(text),
        })
    return skills


def _collect_session_summary() -> dict[str, Any]:
    try:
        from hermes_state import SessionDB  # type: ignore

        db = SessionDB()
        try:
            if hasattr(db, "list_sessions"):
                sessions = db.list_sessions(limit=25)
            else:
                sessions = db.search_sessions(limit=25)
        finally:
            close = getattr(db, "close", None)
            if callable(close):
                close()
        return {"available": True, "recent_count": len(sessions), "sample": [str(s)[:180] for s in sessions[:5]]}
    except Exception:
        return {"available": False, "recent_count": 0, "sample": []}


def _evidence_items(category: str, sources: list[dict[str, Any]], limit: int = 3) -> list[dict[str, str]]:
    needles = CATEGORY_RULES.get(category, [])
    items: list[dict[str, str]] = []
    for source in sources:
        text = source.get("text", "")
        chunks = re.split(r"(?<=[.!?])\s+|\n+", text)
        for chunk in chunks:
            clean = " ".join(chunk.strip().lstrip("-•* ").split())
            if not clean:
                continue
            lower = clean.lower()
            if any(needle in lower for needle in needles):
                items.append({"source": source.get("name", "memory"), "text": clean[:180]})
                break
        if len(items) >= limit:
            break
    return items


def build_memory_structure(genome: dict[str, Any], sources: list[dict[str, Any]]) -> dict[str, Any]:
    """Build a functional map of memory sections, gaps, evidence, and relationships."""
    categories = genome.get("categories", {})
    totals = genome.get("totals", {})
    skills = genome.get("skills", [])
    section_meta = {
        "identity": ("Identity", "who the agent is and what role it plays", "Add a short identity note: role, scope, and who the agent helps."),
        "preferences": ("User preferences", "how the user wants the agent to behave", "Record durable user preferences or communication style."),
        "projects": ("Projects", "active repos, products, domains, and work context", "Add stable project conventions or current project names."),
        "skills": ("Skills", "procedural knowledge the agent can reuse", "Create or update skills for repeated workflows."),
        "safety": ("Safety", "boundaries, secrets, permissions, and confirmation rules", "Add credential, privacy, and approval boundaries."),
        "recent": ("Recent learning", "fresh session notes and newly learned context", "Add daily notes or create a new skill after meaningful work."),
    }
    sections = []
    for key in ["identity", "preferences", "projects", "skills", "safety", "recent"]:
        label, description, recommendation = section_meta[key]
        count = len(skills) if key == "skills" else int(categories.get(key, 0))
        status = "present" if count > 0 else "gap"
        if key == "skills":
            items = [{"source": "skills", "text": skill.get("name", "unnamed skill")[:180]} for skill in skills[:5]]
        else:
            items = _evidence_items(key, sources)
        sections.append({
            "id": key,
            "label": label,
            "description": description,
            "count": count,
            "status": status,
            "items": items,
            "recommendation": recommendation if status == "gap" else "Keep this section current as memory changes.",
        })

    present = [section for section in sections if section["status"] == "present"]
    gaps = [section for section in sections if section["status"] == "gap"]
    coverage = len(present) / len(sections) if sections else 0
    if coverage >= 0.75:
        coverage_label = "balanced"
    elif coverage >= 0.4:
        coverage_label = "developing"
    else:
        coverage_label = "thin"

    edges = []
    for a, b, reason in [
        ("identity", "preferences", "behavior depends on role + user expectations"),
        ("projects", "skills", "project work becomes reusable procedure"),
        ("safety", "projects", "project actions need boundaries"),
        ("recent", "skills", "recent learning can become skills"),
        ("preferences", "safety", "preferences and boundaries shape responses"),
    ]:
        sa = next(section for section in sections if section["id"] == a)
        sb = next(section for section in sections if section["id"] == b)
        if sa["status"] == "present" and sb["status"] == "present":
            edges.append({"from": a, "to": b, "reason": reason})

    return {
        "summary": {
            "coverage": round(coverage, 2),
            "coverage_label": coverage_label,
            "present_sections": len(present),
            "gap_sections": len(gaps),
            "primary_gap": gaps[0]["id"] if gaps else None,
            "total_sources": totals.get("memory_sources", 0),
            "total_skills": totals.get("skills", 0),
        },
        "sections": sections,
        "edges": edges,
    }


def build_insights(genome: dict[str, Any]) -> dict[str, Any]:
    """Translate the visual genome into plain-English things worth noticing."""
    categories = genome.get("categories", {})
    totals = genome.get("totals", {})
    signals = genome.get("signals", {})
    keywords = genome.get("keywords", [])
    dominant_category = max(categories, key=lambda key: categories.get(key, 0)) if categories else "memory"
    dominant_value = categories.get(dominant_category, 0)
    motif = ", ".join(keywords[:3]) if keywords else "uncategorized memory"

    takeaways: list[dict[str, str]] = [
        {
            "kind": "dominant",
            "title": "Dominant motif",
            "text": f"The strongest signal is {dominant_category} ({dominant_value} hits), with motifs around {motif}.",
        }
    ]

    if totals.get("memory_sources", 0) <= 1:
        takeaways.append({
            "kind": "coverage",
            "title": "Low source coverage",
            "text": "This bloom is based on very few memory files, so the artwork is more like a sketch than a full portrait.",
        })
    if categories.get("identity", 0) == 0:
        takeaways.append({
            "kind": "gap",
            "title": "Identity gap",
            "text": "No identity signals were found. Add who the agent is, who it helps, or what role it plays to give the center more meaning.",
        })
    if categories.get("safety", 0) == 0:
        takeaways.append({
            "kind": "gap",
            "title": "Safety gap",
            "text": "No safety signals were found. If this agent has boundaries or credential rules, they are not visible in this bloom.",
        })
    if categories.get("recent", 0) == 0:
        takeaways.append({
            "kind": "gap",
            "title": "No recent-growth signal",
            "text": "The bloom does not show much recent learning yet; add daily notes or new skills to make the timeline evolve.",
        })

    complexity = int(round(float(signals.get("complexity", 0)) * 100))
    stability = int(round(float(signals.get("stability", 0)) * 100))
    novelty = int(round(float(signals.get("novelty", 0)) * 100))
    takeaways.append({
        "kind": "reading",
        "title": "Visual reading",
        "text": f"Complexity is {complexity}%, stability is {stability}%, and novelty is {novelty}% — more rings and chords mean denser memory structure.",
    })

    if totals.get("memory_sources", 0) <= 1 or categories.get("identity", 0) == 0:
        action = "Add a short identity/user-profile memory, then grow a new bloom."
    elif categories.get("safety", 0) == 0:
        action = "Add explicit safety or credential-handling rules, then grow a new bloom."
    elif categories.get("recent", 0) == 0:
        action = "Create a recent daily note or skill update to make the next bloom show growth."
    else:
        action = "Compare this bloom to the next snapshot after a meaningful memory or skill change."
    takeaways.append({"kind": "action", "title": "Suggested next bloom", "text": action})

    return {
        "headline": f"This bloom is mostly about {dominant_category}: {motif}.",
        "dominant_category": dominant_category,
        "dominant_value": dominant_value,
        "motif": motif,
        "takeaways": takeaways[:5] + [takeaways[-1]],
        "legend": {
            "center": "Center = total memory sources, skills, and recent sessions feeding this bloom.",
            "rings": "Rings = stability and long-term structure; more complete context produces calmer nested rings.",
            "petals": "Petals = category signals such as identity, preferences, projects, safety, and recent learning.",
            "nodes": "Outer nodes/chords = skill and keyword constellations; denser chords mean more interconnected context.",
            "keywords": "Outer words = strongest motifs extracted from memory and skill names.",
            "timeline": "Each saved bloom is a local snapshot; compare snapshots to see how memory changed over time.",
        },
    }


def compute_memory_genome(home: Path | None = None) -> dict[str, Any]:
    """Return a deterministic visual DNA summary of the current Hermes memory state."""
    home = Path(home or hermes_home())
    sources = _collect_memory_sources(home)
    skills = _collect_skills(home)
    session_summary = _collect_session_summary()

    combined_text = "\n\n".join(s["text"] for s in sources)[:MAX_TEXT_CHARS]
    skill_text = "\n".join(skill["name"] for skill in skills)
    categories = _category_counts(combined_text + "\n" + skill_text)
    keywords = _extract_keywords(combined_text + "\n" + skill_text)

    basis = {
        "sources": [{k: v for k, v in s.items() if k != "text"} for s in sources],
        "skills": skills,
        "categories": categories,
        "keywords": keywords,
        "sessions": session_summary,
    }
    state_hash = _sha(_stable_json(basis))
    palette = PALETTES[int(state_hash[:2], 16) % len(PALETTES)]
    total_signals = sum(categories.values()) + len(skills) + len(sources)
    complexity = min(1.0, math.log1p(total_signals) / math.log(120)) if total_signals else 0.05
    stability = 1.0 - min(0.8, len([s for s in sources if s["kind"] == "daily"]) / 75)
    novelty = min(1.0, session_summary.get("recent_count", 0) / 25)

    genome = {
        "schema_version": 1,
        "state_hash": state_hash,
        "seed": int(state_hash[:12], 16),
        "generated_from": str(home),
        "palette": palette,
        "categories": categories,
        "keywords": keywords,
        "sources": [{k: v for k, v in s.items() if k != "text"} for s in sources],
        "skills": skills,
        "sessions": session_summary,
        "totals": {
            "memory_sources": len(sources),
            "memory_chars": sum(s["chars"] for s in sources),
            "skills": len(skills),
            "recent_sessions": session_summary.get("recent_count", 0),
        },
        "signals": {
            "complexity": round(complexity, 3),
            "stability": round(stability, 3),
            "novelty": round(novelty, 3),
        },
    }
    genome["structure"] = build_memory_structure(genome, sources)
    genome["insights"] = build_insights(genome)
    return genome


def load_timeline(data_dir: Path | None = None) -> dict[str, Any]:
    data_dir = Path(data_dir or default_data_dir())
    path = data_dir / "timeline.json"
    if not path.exists():
        return {"snapshots": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if isinstance(data.get("snapshots"), list):
            return data
    except Exception:
        pass
    return {"snapshots": []}


def _save_timeline(data_dir: Path, timeline: dict[str, Any]) -> None:
    data_dir.mkdir(parents=True, exist_ok=True)
    timeline["snapshots"] = timeline.get("snapshots", [])[-MAX_TIMELINE:]
    (data_dir / "timeline.json").write_text(json.dumps(timeline, indent=2, sort_keys=True), encoding="utf-8")


def _snapshot_summary(snapshot: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": snapshot["id"],
        "created_at": snapshot["created_at"],
        "state_hash": snapshot["state_hash"],
        "seed": snapshot["seed"],
        "reason": snapshot["reason"],
        "palette": snapshot.get("palette", []),
        "keywords": snapshot.get("keywords", [])[:8],
        "totals": snapshot.get("totals", {}),
        "signals": snapshot.get("signals", {}),
        "categories": snapshot.get("categories", {}),
        "insights": snapshot.get("insights", {}),
        "structure": snapshot.get("structure", {}),
    }


def _reason_for_change(previous: dict[str, Any] | None, genome: dict[str, Any], force: bool) -> str:
    if not previous:
        return "initial bloom"
    if force and previous.get("state_hash") == genome["state_hash"]:
        return "manual bloom"
    prev_totals = previous.get("totals", {})
    curr_totals = genome.get("totals", {})
    parts = ["memory state changed"]
    for key, label in [("memory_sources", "sources"), ("skills", "skills"), ("recent_sessions", "sessions")]:
        delta = curr_totals.get(key, 0) - prev_totals.get(key, 0)
        if delta:
            parts.append(f"{delta:+d} {label}")
    prev_keys = set(previous.get("keywords", []))
    new_keys = [k for k in genome.get("keywords", []) if k not in prev_keys][:3]
    if new_keys:
        parts.append("new motifs: " + ", ".join(new_keys))
    return "; ".join(parts)


def generate_snapshot(home: Path | None = None, data_dir: Path | None = None, force: bool = False) -> dict[str, Any]:
    home = Path(home or hermes_home())
    data_dir = Path(data_dir or default_data_dir())
    genome = compute_memory_genome(home)
    timeline = load_timeline(data_dir)
    previous = timeline.get("snapshots", [])[-1] if timeline.get("snapshots") else None
    if previous and previous.get("state_hash") == genome["state_hash"] and not force:
        return previous

    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    snap_basis = f"{now}:{genome['state_hash']}:{len(timeline.get('snapshots', []))}"
    snapshot = {
        "id": _sha(snap_basis)[:16],
        "created_at": now,
        "reason": _reason_for_change(previous, genome, force),
        **genome,
    }
    snapshot["svg"] = render_snapshot_svg(snapshot)

    snapshots_dir = data_dir / "snapshots"
    snapshots_dir.mkdir(parents=True, exist_ok=True)
    (snapshots_dir / f"{snapshot['id']}.json").write_text(json.dumps(snapshot, indent=2, sort_keys=True), encoding="utf-8")
    (snapshots_dir / f"{snapshot['id']}.svg").write_text(snapshot["svg"], encoding="utf-8")

    timeline.setdefault("snapshots", []).append(_snapshot_summary(snapshot))
    _save_timeline(data_dir, timeline)
    return snapshot


def current_snapshot(home: Path | None = None, data_dir: Path | None = None) -> dict[str, Any]:
    data_dir = Path(data_dir or default_data_dir())
    timeline = load_timeline(data_dir)
    if timeline.get("snapshots"):
        latest = timeline["snapshots"][-1]
        path = data_dir / "snapshots" / f"{latest['id']}.json"
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except Exception:
                pass
    return generate_snapshot(home=home, data_dir=data_dir, force=True)


def _point(cx: float, cy: float, radius: float, angle: float) -> tuple[float, float]:
    return cx + math.cos(angle) * radius, cy + math.sin(angle) * radius


def render_snapshot_svg(snapshot: dict[str, Any], size: int = 720) -> str:
    """Render a deterministic standalone SVG for timeline exports and tests."""
    seed = int(snapshot.get("seed", 1))
    palette = snapshot.get("palette") or PALETTES[0]
    categories = snapshot.get("categories", {})
    keywords = snapshot.get("keywords", [])[:10]
    signals = snapshot.get("signals", {})
    cx = cy = size / 2
    rings = 5 + (seed % 5)
    petals = 10 + (seed % 14)
    complexity = float(signals.get("complexity", 0.5))
    novelty = float(signals.get("novelty", 0.2))

    parts = [
        f'<svg class="memory-mandala" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-label="Memory Mandala {html.escape(snapshot.get("state_hash", "")[:12])}">',
        "<defs>",
        f'<radialGradient id="bg" cx="50%" cy="50%"><stop offset="0%" stop-color="{palette[1]}" stop-opacity="0.22"/><stop offset="100%" stop-color="#020617" stop-opacity="1"/></radialGradient>',
        f'<filter id="glow"><feGaussianBlur stdDeviation="3.5" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>',
        "</defs>",
        f'<rect width="{size}" height="{size}" fill="url(#bg)"/>',
        f'<text x="24" y="42" fill="#e2e8f0" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="17" letter-spacing="3">MEMORY MANDALA</text>',
        f'<text x="24" y="66" fill="#94a3b8" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="11">{html.escape(snapshot.get("state_hash", "")[:12])} · {html.escape(snapshot.get("reason", "bloom"))}</text>',
    ]
    # Boundary rings: safety/stability.
    for r in range(rings):
        radius = 78 + r * (36 + complexity * 10)
        color = palette[r % len(palette)]
        dash = "" if r % 2 else ' stroke-dasharray="2 10"'
        parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{radius:.1f}" fill="none" stroke="{color}" stroke-opacity="{0.16 + r / (rings * 7):.3f}" stroke-width="1.4"{dash}/>' )
    # Petal lattice.
    for i in range(petals):
        angle = (math.tau * i / petals) + ((seed % 360) * math.pi / 1800)
        cat_value = list(categories.values())[i % max(1, len(categories))] if categories else 1
        length = 130 + (cat_value % 9) * 10 + complexity * 80
        width = 20 + (seed >> (i % 16) & 15)
        x, y = _point(cx, cy, length / 2, angle)
        rot = angle * 180 / math.pi
        color = palette[i % len(palette)]
        parts.append(f'<ellipse cx="{x:.2f}" cy="{y:.2f}" rx="{width:.2f}" ry="{length/2:.2f}" transform="rotate({rot:.2f} {x:.2f} {y:.2f})" fill="{color}" fill-opacity="0.08" stroke="{color}" stroke-opacity="0.46" stroke-width="1" filter="url(#glow)"/>')
    # Constellation nodes and chords.
    node_count = max(8, min(28, len(keywords) + snapshot.get("totals", {}).get("skills", 0) // 2 + 8))
    nodes = []
    for i in range(node_count):
        angle = math.tau * i / node_count + (seed % 99) / 99
        radius = 170 + ((seed >> (i % 24)) & 31) + novelty * 70
        nodes.append(_point(cx, cy, radius, angle))
    for i, (x, y) in enumerate(nodes):
        j = (i * 5 + seed) % node_count
        x2, y2 = nodes[j]
        parts.append(f'<line x1="{x:.1f}" y1="{y:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" stroke="{palette[(i+1)%len(palette)]}" stroke-opacity="0.18" stroke-width="1"/>')
    for i, (x, y) in enumerate(nodes):
        color = palette[i % len(palette)]
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{3 + (i % 5):.1f}" fill="{color}" fill-opacity="0.86" filter="url(#glow)"/>')
    parts.append(f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="52" fill="#020617" fill-opacity="0.72" stroke="{palette[0]}" stroke-opacity="0.8" stroke-width="1.5"/>')
    parts.append(f'<text x="{cx:.1f}" y="{cy-4:.1f}" text-anchor="middle" fill="#f8fafc" font-family="ui-monospace, monospace" font-size="14">{len(snapshot.get("sources", []))} sources</text>')
    parts.append(f'<text x="{cx:.1f}" y="{cy+18:.1f}" text-anchor="middle" fill="#cbd5e1" font-family="ui-monospace, monospace" font-size="11">{snapshot.get("totals", {}).get("skills", 0)} skills · {snapshot.get("totals", {}).get("recent_sessions", 0)} sessions</text>')
    for i, kw in enumerate(keywords[:8]):
        angle = math.tau * i / max(1, min(8, len(keywords))) - math.pi / 2
        x, y = _point(cx, cy, 308, angle)
        parts.append(f'<text x="{x:.1f}" y="{y:.1f}" text-anchor="middle" fill="#cbd5e1" fill-opacity="0.72" font-family="ui-monospace, monospace" font-size="10">{html.escape(kw)}</text>')
    parts.append("</svg>")
    return "".join(parts)


@router.get("/state")
async def get_state():
    genome = compute_memory_genome()
    timeline = load_timeline()
    latest_hash = timeline.get("snapshots", [{}])[-1].get("state_hash") if timeline.get("snapshots") else None
    return {
        "genome": genome,
        "timeline": timeline.get("snapshots", []),
        "has_unbloomed_changes": latest_hash != genome["state_hash"],
        "data_dir": str(default_data_dir()),
    }


@router.get("/current")
async def get_current():
    return current_snapshot()


@router.get("/timeline")
async def get_timeline():
    return load_timeline().get("snapshots", [])


@router.post("/generate")
async def post_generate(body: dict[str, Any] | None = None):
    force = bool((body or {}).get("force", False))
    try:
        return generate_snapshot(force=force)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
