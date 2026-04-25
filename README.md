# Memory Mandala

A Hermes dashboard plugin that turns agent memory into a living generative artwork.

Memory Mandala reads local Hermes memory sources, skills, and recent session metadata, computes a deterministic "memory genome," and renders it as a mandala / constellation hybrid. When meaningful memory state changes, you can grow a new bloom and keep a local visual timeline of how the agent's context evolved.

No external APIs. No image model required. No build step required.

## What it does

- Generates a beautiful deterministic SVG artwork from Hermes memory state
- Tracks a local timeline of saved blooms
- Shows a Memory DNA side panel: sources, skills, category signals, keywords
- Adds small dashboard slot widgets in the header, Sessions page, and Skills page
- Stores snapshots locally under the plugin's `data/` directory
- Exposes a FastAPI backend mounted by Hermes at `/api/plugins/memory-mandala/`

## Install

Clone this repository into your Hermes plugins directory:

```bash
git clone https://github.com/mtple/memory-mandala.git ~/.hermes/plugins/memory-mandala
```

Then restart the dashboard, or rescan UI plugins:

```bash
curl http://127.0.0.1:9119/api/dashboard/plugins/rescan
hermes dashboard
```

If backend routes are not available yet, restart `hermes dashboard`; plugin API routes are mounted at dashboard startup.

The **Memory Mandala** tab appears after Skills.

## Plugin layout

```text
dashboard/
├── manifest.json
├── plugin_api.py
└── dist/
    ├── index.js
    └── style.css
```

This repo ships the final browser bundle directly as a plain IIFE in `dashboard/dist/index.js`, so users do not need `npm install` or a frontend build.

## API

Mounted under `/api/plugins/memory-mandala`:

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/state` | Current memory genome, timeline summaries, and whether there are unbloomed changes |
| `GET` | `/current` | Current/latest snapshot; creates an initial bloom if none exists |
| `GET` | `/timeline` | Timeline summary list |
| `POST` | `/generate` | Create a bloom snapshot. Body: `{ "force": false }` |

## How the artwork is generated

The backend scans, best-effort and read-only:

- `$HERMES_HOME/MEMORY.md`
- `$HERMES_HOME/USER.md`
- `$HERMES_HOME/AGENTS.md`
- `$HERMES_HOME/SOUL.md`
- `$HERMES_HOME/memory/*.md`
- `$HERMES_HOME/memory/*.json`
- `$HERMES_HOME/skills/**/SKILL.md`
- recent session count via `hermes_state.SessionDB` when importable

It computes:

- a stable `state_hash`
- deterministic numeric `seed`
- category counts: identity, preferences, projects, skills, safety, recent
- keywords / motifs
- visual signals: complexity, stability, novelty
- palette selection

The frontend uses those values to render a procedural SVG. The same memory state yields the same base mandala, which makes changes visually meaningful.

## Cadence

The plugin does **not** automatically create a new image after every session. Instead:

- `/state` reports `has_unbloomed_changes` when the current memory hash differs from the latest saved bloom
- the **Grow Mandala** button creates a new snapshot only when state changed
- **Force Bloom** creates a manual snapshot even if the hash is unchanged

This keeps the timeline meaningful instead of noisy.

## Development

Run tests:

```bash
python -m pytest tests/ -q
```

The tests use temporary fake Hermes homes and do not require Hermes to be installed.

## Safety / privacy

All analysis runs locally. The plugin does not send memory content to any external service. Snapshot JSON and SVG files are written locally to:

```text
~/.hermes/plugins/memory-mandala/data/
```

when installed in the normal plugins directory.

## License

MIT
