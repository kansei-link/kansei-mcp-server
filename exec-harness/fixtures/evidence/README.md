# fixtures/evidence — kept as evidence, never judged directly

- `free-text-cases-pre-closed-form.json`: the 44 free-text answer cases judged before the closed two-line form (2026-09-27). Their expectations describe the retired free-text rules and are NOT regression targets.
- `codex-e4955ec-independent-evidence.json`: Codex's independent review evidence for commit e4955ec (all URLs and catalog values invented, per its provenance field). Its 30 answer cases (R01–R30) and 9 catalog payloads are copied verbatim into `../llm-answer-cases.json` (as CX-R01…CX-R30) and `../catalog-payload-cases.json` (as CXK01…CXK09), which ARE regression targets; its prefixChecks are replayed by scripts/smoke-marker-llm-answer.mts.
- Codex's earlier N/T answers (dfe71de review) were never received ("prior_N_T_note" in the evidence file says they were unavailable to that session); nothing was reconstructed.
