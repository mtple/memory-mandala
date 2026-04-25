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

    assert insights["headline"].startswith("This bloom is mostly about")
    assert insights["dominant_category"] == "projects"
    assert any(item["kind"] == "gap" and "safety" in item["text"].lower() for item in insights["takeaways"])
    assert any(item["kind"] == "action" for item in insights["takeaways"])
    assert insights["legend"]["center"].startswith("Center")
    assert "petals" in insights["legend"]


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

    assert structure["summary"]["coverage_label"] in {"balanced", "developing", "thin"}
    sections = {section["id"]: section for section in structure["sections"]}
    assert set(sections) == {"identity", "preferences", "projects", "skills", "safety", "recent"}
    assert sections["identity"]["status"] == "present"
    assert sections["safety"]["status"] == "present"
    assert sections["skills"]["items"]
    assert any("MEMORY.md" in item["source"] for item in sections["identity"]["items"])
    assert structure["edges"]


def test_memory_structure_marks_missing_sections_as_gaps(tmp_path):
    api = load_plugin_api()
    home = tmp_path / "hermes"
    home.mkdir()
    (home / "MEMORY.md").write_text("Project dashboard plugin plugin.\n", encoding="utf-8")

    structure = api.compute_memory_genome(home)["structure"]
    sections = {section["id"]: section for section in structure["sections"]}

    assert sections["identity"]["status"] == "gap"
    assert sections["safety"]["status"] == "gap"
    assert "add" in sections["identity"]["recommendation"].lower()
