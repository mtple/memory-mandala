import importlib.util
import json
from pathlib import Path


def load_plugin_api():
    module_path = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("memory_mandala_plugin_api", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_compute_memory_genome_is_deterministic_and_categorizes_sources(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    (home / "memory").mkdir(parents=True)
    (home / "skills" / "github" / "code-review").mkdir(parents=True)

    (home / "MEMORY.md").write_text(
        "User prefers concise answers. Project uses pytest. Never expose API keys.\n",
        encoding="utf-8",
    )
    (home / "USER.md").write_text("Name: Ada\nRole: researcher\n", encoding="utf-8")
    (home / "memory" / "2026-04-25.md").write_text(
        "- Learned the dashboard plugin API.\n- Created a memory workflow.\n",
        encoding="utf-8",
    )
    (home / "memory" / "state.json").write_text(
        json.dumps({"lastChecks": {"email": 123}, "topic": "automation"}),
        encoding="utf-8",
    )
    (home / "skills" / "github" / "code-review" / "SKILL.md").write_text(
        "---\nname: code-review\n---\n# Code Review\nReview diffs safely.\n",
        encoding="utf-8",
    )

    first = api.compute_memory_genome(home)
    second = api.compute_memory_genome(home)

    assert first["state_hash"] == second["state_hash"]
    assert first["seed"] == second["seed"]
    assert first["totals"]["memory_sources"] == 4
    assert first["totals"]["skills"] == 1
    assert first["categories"]["preferences"] >= 1
    assert first["categories"]["safety"] >= 1
    assert "pytest" in first["keywords"]


def test_generate_snapshot_persists_timeline_and_detects_change_reason(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    data_dir = tmp_path / "plugin-data"
    home.mkdir()
    (home / "MEMORY.md").write_text("User likes quiet dashboards.\n", encoding="utf-8")

    first = api.generate_snapshot(home=home, data_dir=data_dir, force=True)
    timeline = api.load_timeline(data_dir)

    assert first["state_hash"]
    assert first["reason"] == "initial bloom"
    assert len(timeline["snapshots"]) == 1
    assert (data_dir / "snapshots" / f"{first['id']}.json").exists()

    repeated = api.generate_snapshot(home=home, data_dir=data_dir, force=False)
    assert repeated["id"] == first["id"]
    assert len(api.load_timeline(data_dir)["snapshots"]) == 1

    (home / "USER.md").write_text("Name: Grace\nPrefers precise reports.\n", encoding="utf-8")
    changed = api.generate_snapshot(home=home, data_dir=data_dir, force=False)

    assert changed["id"] != first["id"]
    assert "memory state changed" in changed["reason"]
    assert len(api.load_timeline(data_dir)["snapshots"]) == 2


def test_svg_renderer_is_deterministic_for_same_snapshot(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    data_dir = tmp_path / "plugin-data"
    home.mkdir()
    (home / "MEMORY.md").write_text("Project uses FastAPI and local-first plugins.\n", encoding="utf-8")

    snapshot = api.generate_snapshot(home=home, data_dir=data_dir, force=True)
    svg_a = api.render_snapshot_svg(snapshot)
    svg_b = api.render_snapshot_svg(snapshot)

    assert svg_a == svg_b
    assert svg_a.startswith("<svg")
    assert "memory-mandala" in svg_a
    assert snapshot["state_hash"][:12] in svg_a


def test_memory_genome_includes_plain_english_insights(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    home.mkdir()
    (home / "MEMORY.md").write_text(
        "Project dashboard plugin plugin plugin. User prefers concise UI.\n",
        encoding="utf-8",
    )

    genome = api.compute_memory_genome(home)
    insights = genome["insights"]

    assert insights["headline"]
    assert insights["dominant_category"] in {"projects", "preferences", "memory"}
    assert any(item["text"] for item in insights["takeaways"])
    assert insights["legend"]["nodes"].startswith("Nodes are real memory")
    assert "connections" in insights["legend"]


def test_snapshot_summary_preserves_insights_for_timeline(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    data_dir = tmp_path / "plugin-data"
    home.mkdir()
    (home / "MEMORY.md").write_text("Never leak secrets. User prefers verified answers.\n", encoding="utf-8")

    snapshot = api.generate_snapshot(home=home, data_dir=data_dir, force=True)
    timeline = api.load_timeline(data_dir)["snapshots"]

    assert snapshot["insights"]["takeaways"]
    assert timeline[0]["insights"]["headline"] == snapshot["insights"]["headline"]


def test_memory_structure_is_functional_not_decorative(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    (home / "memory").mkdir(parents=True)
    (home / "skills" / "ops" / "deploy").mkdir(parents=True)
    (home / "MEMORY.md").write_text(
        "Identity: coding agent. User prefers concise verified answers. Project uses FastAPI. Never leak secrets.\n",
        encoding="utf-8",
    )
    (home / "memory" / "2026-04-25.md").write_text("Recent: learned dashboard plugin workflow.\n", encoding="utf-8")
    (home / "skills" / "ops" / "deploy" / "SKILL.md").write_text("---\nname: deploy\n---\n# Deploy workflow\n", encoding="utf-8")

    genome = api.compute_memory_genome(home)
    structure = genome["structure"]

    assert structure["summary"]["fact_count"] >= 1
    assert "coverage_label" not in structure["summary"]
    sections = {section["id"]: section for section in structure["sections"]}
    assert set(sections) == {"identity", "preferences", "projects", "skills", "safety", "recent"}
    assert sections["identity"]["status"] == "present"
    assert sections["safety"]["status"] == "present"
    assert sections["skills"]["items"]
    assert any("MEMORY.md" in item["source"] for item in sections["identity"]["items"])
    assert "memory_graph" in structure


def test_memory_structure_marks_missing_sections_as_gaps(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    home.mkdir()
    (home / "MEMORY.md").write_text("Project dashboard plugin plugin.\n", encoding="utf-8")

    structure = api.compute_memory_genome(home)["structure"]
    sections = {section["id"]: section for section in structure["sections"]}

    assert sections["identity"]["status"] == "gap"
    assert sections["safety"]["status"] == "gap"
    assert "add" in sections["identity"]["summary_text"].lower()


def test_reads_hermes_memories_directory_and_builds_descriptive_labels(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    (home / "memories").mkdir(parents=True)
    (home / "memories" / "MEMORY.md").write_text(
        "Identity & Role: tortOS, AI operator of Tortoise, a social music platform on Farcaster/Base.\n"
        "Voice & Posting Rules: lowercase, no emojis, chill late-night DJ energy.\n"
        "Security: Never send API keys, tokens, or credentials over Telegram.\n",
        encoding="utf-8",
    )
    (home / "memories" / "USER.md").write_text(
        "Matt prefers emailed reports in clean HTML, not raw Markdown.\n",
        encoding="utf-8",
    )

    genome = api.compute_memory_genome(home)
    sources = {source["name"] for source in genome["sources"]}
    sections = {section["id"]: section for section in genome["structure"]["sections"]}

    assert "MEMORY.md" in sources
    assert sections["identity"]["summary_text"].startswith("tortOS, AI operator of Tortoise")
    assert "lowercase" in sections["preferences"]["summary_text"] or "HTML" in sections["preferences"]["summary_text"]
    assert "Never send API keys" in sections["safety"]["summary_text"]
    assert genome["structure"]["art_layers"]


def test_skills_are_ranked_by_session_usage(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    (home / "skills" / "github" / "github-pr-workflow").mkdir(parents=True)
    (home / "skills" / "research" / "arxiv").mkdir(parents=True)
    (home / "skills" / "creative" / "pixel-art").mkdir(parents=True)
    (home / "sessions").mkdir(parents=True)
    for name in ["github-pr-workflow", "arxiv", "pixel-art"]:
        (home / "skills" / ("github" if name.startswith("github") else "research" if name == "arxiv" else "creative") / name / "SKILL.md").write_text(
            f"---\nname: {name}\n---\n# {name}\n", encoding="utf-8"
        )
    (home / "sessions" / "session_one.json").write_text(
        "github-pr-workflow github-pr-workflow arxiv", encoding="utf-8"
    )
    (home / "sessions" / "session_two.json").write_text(
        "github-pr-workflow pixel-art", encoding="utf-8"
    )

    genome = api.compute_memory_genome(home)
    skills = genome["skills"]
    skill_section = {section["id"]: section for section in genome["structure"]["sections"]}["skills"]

    assert [skill["name"] for skill in skills[:3]] == ["github-pr-workflow", "arxiv", "pixel-art"]
    assert skills[0]["usage_count"] == 3
    assert skills[1]["usage_count"] == 1
    assert skills[2]["usage_count"] == 1
    assert skills[0]["usage_heat"] == 1.0
    assert skill_section["items"][0]["usage_count"] == 3
    assert "memory graph" in skill_section["summary_text"].lower()


def test_memory_graph_connections_are_based_on_shared_memory_evidence(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    (home / "memories").mkdir(parents=True)
    (home / "memory").mkdir(parents=True)
    (home / "skills" / "openclaw" / "farcaster").mkdir(parents=True)

    (home / "memories" / "MEMORY.md").write_text(
        "Identity & Role: tortOS operates Tortoise on Farcaster/Base.\n"
        "Voice & Posting Rules: tortOS posts from tortmusic.eth on Farcaster.\n"
        "Security: Never send API keys or credentials over Telegram.\n",
        encoding="utf-8",
    )
    (home / "memories" / "USER.md").write_text(
        "Matt built Tortoise and prefers tortOS to review Farcaster activity.\n",
        encoding="utf-8",
    )
    (home / "memory" / "2026-04-25.md").write_text(
        "Recent: improved Tortoise Farcaster health review workflow.\n",
        encoding="utf-8",
    )
    (home / "skills" / "openclaw" / "farcaster" / "SKILL.md").write_text(
        "---\nname: farcaster\n---\n# Farcaster\nReview Tortoise and tortmusic.eth activity.\n",
        encoding="utf-8",
    )

    structure = api.compute_memory_genome(home)["structure"]
    graph = structure["memory_graph"]

    assert graph["nodes"], "real memory facts should become graph nodes"
    assert graph["connections"], "shared entities should create evidence-backed connections"
    assert any("tortoise" in conn["shared_terms"] and "farcaster" in conn["shared_terms"] for conn in graph["connections"])
    assert all(conn["evidence"] and conn["source"] == "shared-memory" for conn in graph["connections"])
    assert not any(conn["reason"] == "project work becomes reusable procedure" for conn in graph["connections"])


def test_memory_structure_avoids_generic_coverage_filler(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    home.mkdir()
    (home / "MEMORY.md").write_text(
        "Matt prefers concise verified answers. Never send credentials over Telegram.\n",
        encoding="utf-8",
    )

    genome = api.compute_memory_genome(home)
    summary = genome["structure"]["summary"]
    insights = genome["insights"]

    assert "coverage" not in summary
    assert "coverage_label" not in summary
    assert "100%" not in insights["headline"]
    assert not any("complexity is" in item["text"].lower() for item in insights["takeaways"])
    assert any("Matt" in item["text"] or "credentials" in item["text"] for item in insights["takeaways"])


def test_memory_graph_omits_weak_single_term_connections(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    home.mkdir()
    (home / "MEMORY.md").write_text(
        "Alpha project uses banana.\n"
        "Beta note mentions banana.\n"
        "Tortoise Farcaster posts use tortmusic.eth embeds.\n"
        "Matt reviews Tortoise Farcaster activity for tortmusic.eth.\n",
        encoding="utf-8",
    )

    graph = api.compute_memory_genome(home)["structure"]["memory_graph"]

    assert graph["connections"]
    assert all(len(conn["shared_terms"]) >= 2 for conn in graph["connections"])
    assert not any(conn["shared_terms"] == ["banana"] for conn in graph["connections"])
    assert any({"tortoise", "farcaster"}.issubset(set(conn["shared_terms"])) for conn in graph["connections"])



def test_active_frontend_bundle_has_dynamic_side_pane_not_popup():
    repo = Path(__file__).resolve().parents[1]
    manifest = json.loads((repo / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    bundle = (repo / "dashboard" / manifest["entry"]).read_text(encoding="utf-8")

    assert "function DynamicInsightPane" in bundle
    assert "live detail" in bundle
    assert "evidence rows" in bundle
    assert "function Overlay" not in bundle
    assert "setPinned" not in bundle


def test_active_frontend_bundle_uses_one_left_pane_without_duplicate_header():
    repo = Path(__file__).resolve().parents[1]
    manifest = json.loads((repo / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    bundle = (repo / "dashboard" / manifest["entry"]).read_text(encoding="utf-8")

    assert "mm-left-pane" in bundle
    assert "mm-pane-intro" in bundle
    assert "evidence map" not in bundle
    assert "expanded source-backed facts" not in bundle


def test_active_styles_use_full_left_pane_without_tiny_text_windows():
    repo = Path(__file__).resolve().parents[1]
    manifest = json.loads((repo / "dashboard" / "manifest.json").read_text(encoding="utf-8"))
    styles = (repo / "dashboard" / manifest["css"]).read_text(encoding="utf-8")

    assert "v2.0.0: full-pane reading layout" in styles
    assert "grid-template-columns: 1fr" in styles
    assert ".mm-left-pane .mm-dynamic-section.evidence" in styles
    assert "max-height: none !important" in styles


def test_large_memory_graph_expands_valuable_non_repetitive_data(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    (home / "memories").mkdir(parents=True)
    (home / "memory").mkdir(parents=True)
    (home / "sessions").mkdir(parents=True)
    (home / "skills" / "ops").mkdir(parents=True)

    durable_lines = []
    for i in range(90):
        lane = ["radio", "contracts", "posting", "analytics", "collectors", "artists"][i % 6]
        durable_lines.append(
            f"Project signal {i}: Tortoise Farcaster {lane} workflow tracks catalog-{i} evidence, collector intent, artist context, and Base operations."
        )
    (home / "memories" / "MEMORY.md").write_text("\n".join(durable_lines), encoding="utf-8")

    daily_lines = []
    for i in range(70):
        lane = ["safety", "email", "dashboard", "metrics", "strategy", "skills", "community"][i % 7]
        daily_lines.append(
            f"Recent learning {i}: Matt and tortOS refined Tortoise {lane} practice with Farcaster review, accurate source evidence, and non repetitive decisions."
        )
    (home / "memory" / "2026-04-26.md").write_text("\n".join(daily_lines), encoding="utf-8")

    session_payload = {
        "messages": [
            {
                "role": "user",
                "content": f"Session insight {i}: memory mandala should expose Tortoise Farcaster exploration node-{i} with accurate source detail and category drilldown.",
            }
            for i in range(50)
        ]
    }
    (home / "sessions" / "session_large.json").write_text(json.dumps(session_payload), encoding="utf-8")

    for i in range(30):
        skill_dir = home / "skills" / "ops" / f"workflow-{i}"
        skill_dir.mkdir(parents=True)
        skill_dir.joinpath("SKILL.md").write_text(
            f"---\nname: workflow-{i}\ndescription: Tortoise Farcaster workflow {i} verifies source evidence, category exploration, and reusable operations.\n---\n# Workflow {i}\n",
            encoding="utf-8",
        )

    graph = api.compute_memory_genome(home)["structure"]["memory_graph"]
    texts = [node["text"] for node in graph["nodes"]]

    assert len(graph["nodes"]) >= 120
    assert len(graph["connections"]) >= 120
    assert len(graph["hubs"]) >= 12
    assert len(texts) == len(set(texts))
    assert all(len(conn["shared_terms"]) >= 2 for conn in graph["connections"])
    assert all(conn["evidence"] and conn["source"] == "shared-memory" for conn in graph["connections"])
    assert any(node.get("source_kind") == "session" for node in graph["nodes"])
    assert any(node.get("kind") == "skills" for node in graph["nodes"])
