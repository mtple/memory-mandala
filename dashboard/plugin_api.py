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
MAX_EXTRACTED_FACTS = 1200
MAX_GRAPH_NODES = 180
MAX_GRAPH_LINKS = 420
MAX_GRAPH_HUBS = 60
MAX_SKILL_FACTS = 160
MAX_SESSION_SOURCES = 80
STOPWORDS = {
    "the", "and", "for", "that", "with", "this", "from", "have", "will", "your",
    "user", "agent", "memory", "hermes", "should", "when", "what", "were", "been",
    "into", "their", "there", "about", "which", "would", "could", "than", "then",
    "them", "they", "you", "are", "but", "not", "all", "can", "has", "was", "use", "using",
    "file", "files", "line", "lines", "content", "contents", "source", "sources",
    "button", "click", "page", "view", "views", "pane", "panes", "section", "sections",
    "create", "need", "home", "ubuntu", "path", "code", "local", "current", "latest",
}
CATEGORY_RULES = {
    "identity": ["identity", "role", "name", "called", "pronouns", "timezone", "founder", "operator"],
    "preferences": ["prefers", "preference", "likes", "wants", "style", "tone", "format", "voice", "posting rules", "lowercase", "emoji", "html"],
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


def _frontmatter_value(text: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}:\s*(.+)$", text, flags=re.M | re.I)
    return match.group(1).strip().strip('"\'') if match else ""


def _plain_text(value: Any, max_chars: int = 900) -> str:
    text = str(value or "")
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    text = re.sub(r"https?://\S+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:max_chars]


def _json_text_fragments(data: Any, limit: int = 260) -> list[str]:
    """Extract useful prose from structured JSON without dumping raw config/tool noise."""
    useful_keys = {
        "title", "summary", "preview", "text", "content", "message", "prompt", "response",
        "body", "description", "name", "role", "notes", "decision", "reason", "topic",
    }
    noisy_keys = {
        "token", "api_key", "authorization", "headers", "cookie", "stderr", "stdout", "traceback",
        "screenshot", "image", "base64", "embedding", "vector", "raw", "html", "svg",
    }
    fragments: list[str] = []

    def walk(obj: Any, key: str = "", depth: int = 0) -> None:
        if len(fragments) >= limit or depth > 8:
            return
        key_l = key.lower()
        if key_l in noisy_keys or any(noise in key_l for noise in noisy_keys):
            return
        if isinstance(obj, str):
            if key_l and key_l not in useful_keys and len(obj) > 220:
                return
            clean = _plain_text(obj)
            if _is_valuable_fact(clean):
                fragments.append(clean)
        elif isinstance(obj, dict):
            for k, v in obj.items():
                walk(v, str(k), depth + 1)
                if len(fragments) >= limit:
                    break
        elif isinstance(obj, list):
            for item in obj[:400]:
                walk(item, key, depth + 1)
                if len(fragments) >= limit:
                    break

    walk(data)
    return _unique_strings(fragments, limit)


def _unique_strings(items: list[str], limit: int) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for item in items:
        key = _normalize_fact_key(item)
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(item)
        if len(out) >= limit:
            break
    return out


def _normalize_fact_key(text: str) -> str:
    text = re.sub(r"[`*_>#\[\]()]", " ", text.lower())
    text = re.sub(r"\b\d{4}-\d{2}-\d{2}\b", " ", text)
    text = re.sub(r"[^a-z0-9@._ -]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:260]


def _is_near_duplicate(key: str, seen: set[str]) -> bool:
    if key in seen:
        return True
    key_terms = set(_tokenize(key))
    if len(key_terms) < 4:
        return False
    for other in list(seen)[-900:]:
        other_terms = set(_tokenize(other))
        if len(other_terms) < 4:
            continue
        overlap = len(key_terms & other_terms) / max(1, len(key_terms | other_terms))
        if overlap >= 0.94 or (len(key) > 80 and len(other) > 80 and (key in other or other in key)):
            return True
    return False


def _is_valuable_fact(text: str) -> bool:
    clean = _plain_text(text, 1200)
    if len(clean) < 18 or len(clean) > 700:
        return False
    lower = clean.lower()
    boilerplate = [
        "background process", "matched watch pattern", "command:", "output:", "exit code", "traceback",
        "browser screenshot", "captcha", "verification challenge", "hermes web ui", "tool_calls",
        '"success"', '"error"', "result_type", "line_num",
        "doctype html", "function (", "const ", "var ", "import ", "def ", "class ", "pytest",
    ]
    if any(term in lower for term in boilerplate):
        return False
    if lower.count("{") + lower.count("}") + lower.count("[") + lower.count("]") > 6:
        return False
    tokens = _tokenize(clean)
    if len(set(tokens)) < 2:
        return False
    return True


def _fact_quality(text: str, source_kind: str, terms: list[str]) -> float:
    lower = text.lower()
    score = 0.0
    score += min(16, len(set(terms)) * 1.7)
    score += 5 if 45 <= len(text) <= 240 else 1
    score += 4 if any(ch.isupper() for ch in text[1:]) else 0
    score += 3 if re.search(r"@[a-z0-9_.-]+|\b[A-Z][A-Za-z0-9_.-]{3,}\b", text) else 0
    score += 4 if any(needle in lower for needles in CATEGORY_RULES.values() for needle in needles) else 0
    score += {"memory": 12, "user": 12, "daily": 8, "session": 5, "skill": 6}.get(source_kind, 4)
    score -= 5 if len(text) > 360 else 0
    return round(score, 3)


def _collect_session_sources(home: Path) -> list[dict[str, Any]]:
    sessions_dir = home / "sessions"
    if not sessions_dir.exists():
        return []
    paths = sorted(
        [p for p in sessions_dir.glob("**/*") if p.is_file() and p.suffix.lower() in {".json", ".jsonl", ".md", ".txt"}],
        key=lambda p: p.stat().st_mtime_ns if p.exists() else 0,
        reverse=True,
    )[:MAX_SESSION_SOURCES]
    sources: list[dict[str, Any]] = []
    for path in paths:
        raw = _safe_read(path, 60_000)
        if not raw:
            continue
        fragments: list[str] = []
        if path.suffix.lower() == ".jsonl":
            for line in raw.splitlines()[:500]:
                try:
                    fragments.extend(_json_text_fragments(json.loads(line), limit=12))
                except Exception:
                    continue
        elif path.suffix.lower() == ".json":
            try:
                fragments.extend(_json_text_fragments(json.loads(raw), limit=90))
            except Exception:
                fragments.extend([line.strip() for line in raw.splitlines() if _is_valuable_fact(line.strip())][:60])
        else:
            fragments.extend([line.strip().lstrip("-•* ") for line in raw.splitlines() if _is_valuable_fact(line.strip())][:90])
        fragments = _unique_strings(fragments, 110)
        if fragments:
            text = "\n".join(fragments)
            sources.append({
                "path": str(path),
                "name": f"session:{path.name}",
                "kind": "session",
                "chars": len(text),
                "hash": _sha(text),
                "text": text,
            })
    return sources


def _category_counts(text: str) -> dict[str, int]:
    text = re.sub(r"^_?Last updated:.*$", "", text, flags=re.I | re.M)
    lowered = text.lower()
    counts: dict[str, int] = {}
    for category, needles in CATEGORY_RULES.items():
        counts[category] = sum(lowered.count(needle) for needle in needles)
    # Ensure every category has some visual presence.
    return counts


def _collect_memory_sources(home: Path) -> list[dict[str, Any]]:
    sources: list[dict[str, Any]] = []
    candidates: list[Path] = []
    memories_dir = home / "memories"
    if memories_dir.exists():
        # Durable Hermes memory is the primary source for this plugin. Read it before
        # generic persona files so labels say what the agent remembers, not boilerplate.
        candidates.extend([memories_dir / "MEMORY.md", memories_dir / "USER.md"])
        candidates.extend(sorted(memories_dir.glob("*.md")))
    # Limit the graph to the actual durable memory system. Persona/bootstrap files such
    # as AGENTS.md and SOUL.md contain examples and operating instructions that read as
    # filler in this plugin, so they are intentionally excluded.
    candidates.extend([home / "MEMORY.md", home / "USER.md"])
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
        if not text:
            continue
        kind = "daily" if path.parent.name == "memory" else path.stem.lower()
        if path.suffix.lower() == ".json":
            try:
                fragments = _json_text_fragments(json.loads(text), limit=180)
                if fragments:
                    text = "\n".join(fragments)
            except Exception:
                pass
        sources.append({
            "path": str(path),
            "name": path.name,
            "kind": kind,
            "chars": len(text),
            "hash": _sha(text),
            "text": text,
        })
    sources.extend(_collect_session_sources(home))
    return sources


def _skill_usage_counts(home: Path, skill_names: list[str]) -> dict[str, int]:
    """Count best-effort skill mentions in recent saved session transcripts.

    This intentionally samples recent session files and caches by file signature. The
    dashboard must render quickly; exact all-time counts are less useful than a fast
    heat map of which skills show up most in recent work.
    """
    sessions_dir = home / "sessions"
    counts = {name: 0 for name in skill_names}
    if not sessions_dir.exists() or not skill_names:
        return counts
    paths = sorted(
        set(list(sessions_dir.glob("session_*.json")) + list(sessions_dir.glob("*.jsonl")) + list(sessions_dir.glob("*.json"))),
        key=lambda p: p.stat().st_mtime_ns if p.exists() else 0,
        reverse=True,
    )[:80]
    signature = [[p.name, p.stat().st_mtime_ns, p.stat().st_size] for p in paths if p.is_file()]
    cache_key = _sha(_stable_json({"skills": sorted(skill_names), "files": signature}))
    cache_path = default_data_dir() / "skill_usage_cache.json"
    try:
        if cache_path.exists():
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached.get("cache_key") == cache_key:
                return {name: int(cached.get("counts", {}).get(name, 0)) for name in skill_names}
    except Exception:
        pass

    lowered_names = {name: name.lower() for name in skill_names}
    for path in paths:
        if not path.is_file():
            continue
        text = _safe_read(path, 80_000).lower()
        if not text:
            continue
        for name, lowered in lowered_names.items():
            counts[name] += text.count(lowered)

    try:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_text(json.dumps({"cache_key": cache_key, "counts": counts}, sort_keys=True), encoding="utf-8")
    except Exception:
        pass
    return counts


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
        description = _frontmatter_value(text, "description")
        if not description:
            description_match = re.search(r"^#\s+.+?\n+([^#\n][^\n]{20,500})", text, flags=re.M)
            description = description_match.group(1).strip() if description_match else ""
        headings = [h.strip() for h in re.findall(r"^#{1,3}\s+(.+)$", text, flags=re.M)[:8]]
        skills.append({
            "name": name,
            "description": _plain_text(description, 420),
            "headings": headings,
            "path": str(skill_md),
            "hash": _sha(text),
            "chars": len(text),
        })
    usage = _skill_usage_counts(home, [skill["name"] for skill in skills])
    max_usage = max(usage.values() or [0])
    for skill in skills:
        count = usage.get(skill["name"], 0)
        skill["usage_count"] = count
        skill["usage_heat"] = round(count / max_usage, 3) if max_usage else 0.0
    return sorted(skills, key=lambda s: (-s.get("usage_count", 0), s["name"]))


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
            raw_clean = " ".join(chunk.strip().lstrip("-•* ").split())
            if re.match(r"^_?Last updated:", raw_clean, re.I):
                continue
            clean = re.sub(r"^(?:[#>*\s-]*)(?:[A-Za-z &/]+):\s*", "", raw_clean).strip()
            if not clean:
                continue
            lower = raw_clean.lower()
            if any(needle in lower for needle in needles):
                items.append({"source": source.get("name", "memory"), "text": clean[:180]})
                break
        if len(items) >= limit:
            break
    return items


def _classify_fact(text: str) -> str:
    lower = text.lower()
    scores = {category: sum(lower.count(needle) for needle in needles) for category, needles in CATEGORY_RULES.items()}
    best = max(scores, key=lambda key: scores[key]) if scores else "projects"
    if scores.get(best, 0) == 0:
        return "projects"
    return best


def _memory_terms(text: str, limit: int = 16) -> list[str]:
    """Extract connection terms specific enough to make a real memory link."""
    raw_terms = _tokenize(text)
    generic = STOPWORDS | {
        "prefers", "preference", "preferences", "answers", "verified", "concise",
        "workflow", "workflows", "dashboard", "plugin", "memory", "recent", "learned",
        "identity", "role", "rules", "security", "never", "send", "review", "activity",
        "uses", "built", "created", "updated", "fixed", "operator", "platform", "system",
        "data", "engagement", "works", "scored", "likes", "recast", "replies", "strong",
        "source", "sources", "facts", "fact", "node", "nodes", "user", "assistant",
        "message", "messages", "telegram", "process", "browser", "dashboard", "button",
        "skill", "skills", "file", "files", "using", "source", "sources", "section", "sections",
        "create", "need", "home", "ubuntu", "path", "code", "local", "current", "latest",
    }
    aliases = {
        "tortoise.studio": "tortoise",
        "tortmusic.eth": "tortmusic",
        "farcaster/base": "farcaster",
    }
    terms = []
    for term in raw_terms:
        normalized = aliases.get(term.strip("._-").lower(), term.strip("._-").lower())
        if len(normalized) < 4 or normalized in generic:
            continue
        if re.fullmatch(r"\d+", normalized):
            continue
        if normalized not in terms:
            terms.append(normalized)
        if len(terms) >= limit:
            break
    return terms


def _candidate_chunks(text: str) -> list[str]:
    chunks: list[str] = []
    for line in text.splitlines():
        line = line.strip().lstrip("-•* ")
        if not line:
            continue
        sentence_parts = [part.strip() for part in re.split(r"(?<=[.!?])\s+", line) if part.strip()]
        chunks.extend(sentence_parts or [line])
    if len(chunks) < 4:
        chunks.extend(re.split(r"(?<=[.!?])\s+", text))
    return chunks


def _clean_fact(raw: str) -> str:
    raw = " ".join(raw.strip().lstrip("-•* ").split())
    raw = re.sub(r"^_?Last updated:.*$", "", raw, flags=re.I)
    stripped = re.sub(r"^(?:[#>*\s-]*)(?:[A-Za-z &/]+):\s*", "", raw).strip()
    if len(stripped) >= 18:
        raw = stripped
    return _plain_text(raw, 420)


def _extract_memory_facts(sources: list[dict[str, Any]], skills: list[dict[str, Any]], limit: int = MAX_EXTRACTED_FACTS) -> list[dict[str, Any]]:
    """Turn the actual memory system into many clickable, deduped, evidence-backed facts."""
    candidates: list[dict[str, Any]] = []
    seen: set[str] = set()
    for source in sources:
        source_kind = source.get("kind", "memory")
        for chunk in _candidate_chunks(source.get("text", "")):
            clean = _clean_fact(chunk)
            if not _is_valuable_fact(clean):
                continue
            key = _normalize_fact_key(clean)
            if _is_near_duplicate(key, seen):
                continue
            terms = _memory_terms(clean)
            category = _classify_fact(chunk)
            if not terms and category != "identity":
                continue
            quality = _fact_quality(clean, source_kind, terms)
            candidates.append({
                "id": _sha(f"{source.get('path')}:{clean}")[:12],
                "kind": category,
                "source": source.get("name", "memory"),
                "source_path": source.get("path", ""),
                "text": clean[:360],
                "terms": terms,
                "weight": max(1, min(18, int(round(quality / 3)))),
                "quality": quality,
                "source_kind": source_kind,
            })
            seen.add(key)

    for skill in skills[:MAX_SKILL_FACTS]:
        name = skill.get("name", "unnamed skill")
        description = skill.get("description") or ""
        headings = ", ".join(skill.get("headings", [])[:4])
        text = _plain_text(f"{name}: {description or headings or 'installed Hermes skill'}", 360)
        if not _is_valuable_fact(text):
            text = name
        key = _normalize_fact_key(f"skill {text}")
        if _is_near_duplicate(key, seen):
            continue
        terms = _memory_terms(f"{name} {description} {headings}") or _memory_terms(name.replace("-", " ")) or [name.lower()]
        quality = _fact_quality(text, "skill", terms) + int(skill.get("usage_heat", 0) * 8)
        candidates.append({
            "id": _sha(f"skill:{name}:{description}")[:12],
            "kind": "skills",
            "source": "SKILL.md",
            "source_path": skill.get("path", ""),
            "text": text[:360],
            "terms": terms[:16],
            "weight": max(1, min(18, int(round(quality / 3)))),
            "quality": round(quality, 3),
            "usage_count": skill.get("usage_count", 0),
            "usage_heat": skill.get("usage_heat", 0.0),
            "source_kind": "skill",
        })
        seen.add(key)

    # Preserve category diversity while still ranking by quality.
    by_kind: dict[str, list[dict[str, Any]]] = {key: [] for key in CATEGORY_RULES}
    for fact in sorted(candidates, key=lambda f: (-f.get("quality", 0), f.get("source", ""), f.get("text", ""))):
        by_kind.setdefault(fact.get("kind", "projects"), []).append(fact)
    ordered: list[dict[str, Any]] = []
    per_kind_floor = max(8, min(45, limit // 10))
    for kind in ["identity", "preferences", "projects", "skills", "safety", "recent"]:
        ordered.extend(by_kind.get(kind, [])[:per_kind_floor])
    added = {fact["id"] for fact in ordered}
    for fact in sorted(candidates, key=lambda f: (-f.get("quality", 0), f.get("source", ""), f.get("text", ""))):
        if fact["id"] not in added:
            ordered.append(fact)
            added.add(fact["id"])
        if len(ordered) >= limit:
            break
    return ordered[:limit]


def _build_memory_graph(facts: list[dict[str, Any]], limit: int = MAX_GRAPH_NODES) -> dict[str, Any]:
    nodes = sorted(facts, key=lambda f: (-float(f.get("quality", f.get("weight", 1))), f.get("source", ""), f.get("text", "")))[:limit]
    connections: list[dict[str, Any]] = []
    term_to_nodes: dict[str, list[dict[str, Any]]] = {}
    for node in nodes:
        for term in set(node.get("terms", [])):
            term_to_nodes.setdefault(term, []).append(node)

    seen_pairs: set[str] = set()
    for term, term_nodes in term_to_nodes.items():
        if len(term_nodes) < 2 or len(term_nodes) > 80:
            continue
        ranked = sorted(term_nodes, key=lambda f: -float(f.get("quality", f.get("weight", 1))))[:42]
        for i, a in enumerate(ranked):
            terms_a = set(a.get("terms", []))
            for b in ranked[i + 1:]:
                pair = ":".join(sorted([a["id"], b["id"]]))
                if pair in seen_pairs:
                    continue
                terms_b = set(b.get("terms", []))
                shared = sorted(terms_a & terms_b)
                if len(shared) < 2:
                    continue
                seen_pairs.add(pair)
                weight = len(shared) + (1 if a.get("kind") != b.get("kind") else 0)
                weight += min(3, int((float(a.get("quality", 0)) + float(b.get("quality", 0))) / 20))
                evidence = [a.get("text", ""), b.get("text", "")]
                connections.append({
                    "id": _sha(f"{a['id']}:{b['id']}:{','.join(shared)}")[:12],
                    "from": a["id"],
                    "to": b["id"],
                    "from_kind": a.get("kind"),
                    "to_kind": b.get("kind"),
                    "from_label": a.get("text", "")[:100],
                    "to_label": b.get("text", "")[:100],
                    "shared_terms": shared[:8],
                    "weight": weight,
                    "reason": "shared terms: " + ", ".join(shared[:5]),
                    "source": "shared-memory",
                    "evidence": evidence,
                })
                if len(connections) >= MAX_GRAPH_LINKS * 3:
                    break
            if len(connections) >= MAX_GRAPH_LINKS * 3:
                break
        if len(connections) >= MAX_GRAPH_LINKS * 3:
            break

    connections.sort(key=lambda c: (-c["weight"], c["from_label"], c["to_label"]))
    connections = connections[: min(MAX_GRAPH_LINKS, len(connections))]
    term_counts = Counter(term for node in nodes for term in node.get("terms", []))
    hubs = [{"term": term, "count": count} for term, count in term_counts.most_common(MAX_GRAPH_HUBS) if count > 1]
    return {"nodes": nodes, "connections": connections, "hubs": hubs, "total_facts": len(facts)}


def build_memory_structure(genome: dict[str, Any], sources: list[dict[str, Any]]) -> dict[str, Any]:
    """Build a map from actual memory facts and shared terms, not decorative topic rings."""
    totals = genome.get("totals", {})
    skills = genome.get("skills", [])
    facts = _extract_memory_facts(sources, skills)
    graph = _build_memory_graph(facts)
    facts_by_kind: dict[str, list[dict[str, Any]]] = {key: [] for key in ["identity", "preferences", "projects", "skills", "safety", "recent"]}
    for fact in facts:
        facts_by_kind.setdefault(fact.get("kind", "projects"), []).append(fact)

    section_meta = {
        "identity": ("Identity", "actual identity/role facts found in memory", "Add a durable identity note if this stays empty."),
        "preferences": ("User preferences", "specific user preference facts found in memory", "Record durable preferences as concrete facts."),
        "projects": ("Projects", "project/platform/repo facts found in memory", "Add stable project conventions or names."),
        "skills": ("Skills", "installed workflows connected to remembered work", "Create/update skills for repeated workflows."),
        "safety": ("Safety", "credential/privacy/permission facts found in memory", "Add explicit boundaries for secrets and external actions."),
        "recent": ("Recent learning", "daily/recent facts found in memory", "Write recent learnings when they should survive the session."),
    }
    sections = []
    for key in ["identity", "preferences", "projects", "skills", "safety", "recent"]:
        label, description, recommendation = section_meta[key]
        items = []
        for fact in facts_by_kind.get(key, [])[:8]:
            items.append({
                "source": fact.get("source", "memory"),
                "text": fact.get("text", ""),
                "terms": fact.get("terms", []),
                "usage_count": fact.get("usage_count", 0),
                "usage_heat": fact.get("usage_heat", 0.0),
            })
        count = len(facts_by_kind.get(key, []))
        status = "present" if count else "gap"
        if key == "skills" and items:
            used = [item for item in items if item.get("usage_count", 0) > 0]
            summary_text = "Installed workflows tied into this memory graph: " + ", ".join(
                f"{item['text']} ({item.get('usage_count', 0)} uses)" for item in (used or items)[:4]
            ) + "."
        else:
            summary_text = items[0]["text"] if items else recommendation
        sections.append({
            "id": key,
            "label": label,
            "description": description,
            "count": count,
            "status": status,
            "items": items,
            "summary_text": summary_text,
            "recommendation": recommendation if status == "gap" else "This is backed by actual memory lines; inspect connected facts for context.",
        })

    strongest_hub = graph["hubs"][0]["term"] if graph.get("hubs") else None
    return {
        "summary": {
            "fact_count": len(facts),
            "connection_count": len(graph.get("connections", [])),
            "source_count": totals.get("memory_sources", 0),
            "total_skills": totals.get("skills", 0),
            "strongest_hub": strongest_hub,
            "strongest_terms": [hub["term"] for hub in graph.get("hubs", [])[:5]],
        },
        "sections": sections,
        "edges": graph.get("connections", []),
        "memory_graph": graph,
        "art_layers": [
            {
                "id": node["id"],
                "label": node.get("text", "")[:64],
                "kind": node.get("kind"),
                "source": node.get("source"),
                "terms": node.get("terms", []),
                "weight": node.get("weight", 1),
            }
            for node in graph.get("nodes", [])
        ],
    }

def build_insights(genome: dict[str, Any]) -> dict[str, Any]:
    """Explain the specific memory graph without generic visual filler."""
    structure = genome.get("structure", {})
    graph = structure.get("memory_graph", {})
    nodes = graph.get("nodes", [])
    connections = graph.get("connections", [])
    hubs = graph.get("hubs", [])
    top_hub = hubs[0]["term"] if hubs else None
    top_connection = connections[0] if connections else None

    takeaways: list[dict[str, str]] = []
    if top_connection:
        takeaways.append({
            "kind": "connection",
            "title": "Strongest real connection",
            "text": f"{top_connection['from_label']} ↔ {top_connection['to_label']} because both mention {', '.join(top_connection['shared_terms'][:4])}.",
        })
    if top_hub:
        related = [node.get("text", "") for node in nodes if top_hub in node.get("terms", [])][:3]
        takeaways.append({
            "kind": "hub",
            "title": f"Hub: {top_hub}",
            "text": f"{top_hub} appears across {hubs[0]['count']} memory facts: " + " | ".join(related),
        })
    for node in nodes[:2]:
        takeaways.append({
            "kind": node.get("kind", "memory"),
            "title": f"{node.get('source', 'memory')} fact",
            "text": node.get("text", ""),
        })
    if not takeaways:
        takeaways.append({
            "kind": "gap",
            "title": "No connected memory yet",
            "text": "The plugin found memory files, but not enough repeated concrete terms to form reliable links.",
        })

    headline = "Memory graph"
    if top_connection:
        headline = f"{', '.join(top_connection['shared_terms'][:3])} connects remembered facts."
    elif top_hub:
        headline = f"{top_hub} is the clearest memory hub."
    elif nodes:
        headline = f"{nodes[0].get('source', 'memory')} is the clearest memory source."

    return {
        "headline": headline,
        "dominant_category": nodes[0].get("kind", "memory") if nodes else "memory",
        "dominant_value": len(connections),
        "motif": top_hub or "unconnected facts",
        "takeaways": takeaways[:5],
        "legend": {
            "nodes": "Nodes are real memory lines or installed skills from this Hermes home.",
            "connections": "Connections exist only when two facts share concrete extracted terms.",
            "hubs": "Hubs are repeated terms that bind multiple remembered facts together.",
            "sources": "Source labels show which memory file or skill produced the fact.",
            "timeline": "Snapshots preserve this graph so memory changes can be compared later.",
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
