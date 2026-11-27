# AGENTS.md

## Agent skills

### Issue tracker

Issues live in GitHub Issues (`s1nxian/ping`), managed with the `gh` CLI. See `~/core/docs/agents/issue-tracker.md`.

### Triage labels

Default five-role vocabulary (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `~/core/docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `GLOSSARY.md` at the repo root. See `~/core/docs/agents/domain.md`.

### Documentation standards

Any edit to agent-facing docs (`AGENTS.md`, `docs/`, per-component `README.md`) MUST follow
[`AGENT_DOCS_STANDARD.md`](~/core/docs/standards/AGENT_DOCS_STANDARD.md).

### Coding standards

Any code change MUST follow [`CODING_STANDARD.md`](~/core/docs/standards/CODING_STANDARD.md).

## Architecture decisions

Before changing a persisted data format, read
`docs/adr/0003-current-format-only.md`. Other decisions live in `docs/adr/`.
