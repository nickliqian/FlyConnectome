# L3 Workbench Implementation Plan

> **For agentic workers:** Execute inline with the executing-plans workflow. User approved implementation; no additional approval checkpoint is required.

**Goal:** Build a local visual workbench controlling the existing L3 physics simulation.

**Architecture:** A standard-library HTTP server supervises a persistent Python worker. JSON lines carry commands and telemetry; the worker owns physics, rendering, experiment files and export.

**Tech Stack:** Python 3.12, existing FlyGym 2.0.1 / MuJoCo 3.6, plain HTML/CSS/JavaScript, Canvas.

**Spec:** `docs/superpowers/specs/2026-09-17-l3-workbench.md`

## Global Constraints
- Simplified Chinese user interface and documentation.
- New conda environment for server; existing `.venv-l3` worker dependencies remain untouched.
- Loopback only; no external frontend assets or build dependencies.
- True physics feedback; bounded 60-second recordings; scene reset required for physics parameters.
- No git repository is present; supply a Conventional Commits message without committing.

## Tasks
- [x] Configuration and command contract: `l3_workbench/config.py`, `tests/test_workbench.py`. Test rejection of nonfinite values, unknown fields, empty targets, invalid manual signals and reset-only updates before implementation. `validate_config(data, base=None, live=False)` returns an independent normalized dictionary; `validate_command(data)` validates supported operations.
- [x] Worker: `l3_workbench/worker.py`. `python -m l3_workbench.worker` reads JSON commands from stdin, sends state/frame/error messages on stdout. Adapt the existing calibration, CX loop and CPG mapping. Add free camera rendering, true contact telemetry, CSV/events and paused export. Smoke-test real stepping, exact pause, live updates, reset and archive contents.
- [x] Server: `l3_workbench/server.py`. `python -m l3_workbench.server --port 8873` serves explicit static/API routes, supervises worker, bounds command input and enforces request origin/token. Test bad requests, asset traversal and worker startup/death paths.
- [x] UI: `l3_workbench/static/{index.html,style.css,app.js}`. Poll immutable worker snapshots, keep edited scene draft separate from applied state, queue live commands, drag targets in world coordinates, render plots from real samples, display errors and applied status. Verify real browser controls and responsive layout.
- [x] Delivery: `start_l3.command`, `environment-web.yml`, README instructions. Run Python tests, JS syntax check and full real-worker/browser smoke. Leave local server running and open workbench for user.
