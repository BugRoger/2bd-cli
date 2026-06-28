---
phase: design-research
topic: session-end-memory-capture
date: 2026-06-28
epic-id: bm-f8ce
epic-slug: patched-zone-f8ce
sources: 58
strategies_extracted: 132
strategies_verified: 40
---

# Session-End Memory Capture: Research

## TL;DR

- **SessionEnd is the wrong hook to lead with.** SessionEnd cannot inject context back into Claude (no `additionalContext` support) and is observability-only; the actual end-of-session capture mechanism most working systems use is `Stop` (per-turn) or `PreCompact` (before context loss), with SessionEnd as a *flush-and-cache* backstop [1][2].
- **Per-turn extraction (Stop hook) outperforms session-end extraction.** claude-engram and Mem0 both extract incrementally on every Stop event, so SessionEnd is reduced to a briefing-cache writer rather than a primary extractor [2][3]. This eliminates the "session crashed before SessionEnd fired" failure mode that PreCompact-only and SessionEnd-only designs suffer.
- **The capture/extraction split is the single most important architectural decision.** Strategies that capture raw transcripts without an LLM-driven extraction step (claude-qmd-sessions, claude-diary's `/diary` half alone) accumulate a "verbose journal nobody reads" by ~100 sessions. Strategies with an extraction + dedup + decay loop (Mem0, Generative Agents-style importance+recency+relevance, A-MEM evolution) hold up [4][5][6].
- **The two-stage Capture→Compile pattern is the dominant working design.** Cole Medin's claude-memory-compiler, claude-diary's `/diary`+`/reflect`, and Mem0's pairwise-message-extraction+tiering all converge on: cheap append-only capture per session, expensive distillation pass that promotes durable rules into a small always-loaded surface (CLAUDE.md or equivalent) and demotes/merges duplicates [4][7][3].
- **Provenance and trust labeling are non-optional once memory derives from external sources.** Persistent memory poisoning is a published attack class — recalled memories must be treated as data, not instructions, and tainted with source channel (`user_input | tool_output | external_web`) so privileged actions cannot be justified by untrusted recall [8].
- **For 2bd specifically: nearly every "needs new infra" verdict reduced to a missing transcript reader and a missing state directory.** No vector DB, MCP server, or daemon is required; the architecture already supports the pattern via commander subcommands + JSON-to-stdout hooks + `claude -p` subprocess.
- **Cost is bounded but not negligible.** Per-turn Haiku 4.5 extraction at 100 turns/day ≈ $10.50/month; same load on Sonnet 4.6 ≈ $31.50/month. Prompt caching cuts the system-prompt portion ~9x; selective sampling cuts another ~65% [9].

## Hook event landscape

All four candidate events receive `session_id`, `transcript_path`, `cwd`, and `hook_event_name` in their stdin JSON [1]. Beyond that they diverge sharply:

| Event | Fires on | Decision control | `additionalContext` injection | Default timeout (command) | Notable matchers |
|---|---|---|---|---|---|
| **SessionEnd** | Session terminate: `clear` / `resume` / `logout` / `prompt_input_exit` / `bypass_permissions_disabled` / `other` | **None** — output and exit code ignored | **Not supported** — session is ending | 600 s | `reason` |
| **Stop** | Every assistant turn completion | Exit 2 prevents stopping (continues conversation) and feeds stderr back to Claude | Supported via `hookSpecificOutput.additionalContext` | 600 s | None (fires every turn) |
| **SubagentStop** | Task-tool subagent completion | Same as Stop | Supported | 600 s | `agent_type`, plus extra fields `agent_id` and `agent_type` in stdin |
| **PreCompact** | Before compaction (manual `/compact` or auto-trigger) | Exit 2 / `decision: "block"` blocks compaction | **Not supported** — output and exit code do not feed context | 600 s | `manual` / `auto` |

Key consequences that the strategy candidates routinely get wrong:

1. **SessionEnd cannot drive priming or context injection.** Anything that needs to appear in the *next* session must be written to disk by SessionEnd and read by a SessionStart hook on next launch [1]. SessionStart accepts `additionalContext` and has `source` matchers (`startup` / `resume` / `clear` / `compact`) — the `compact` source is the post-compaction re-prime path, not PreCompact [1].
2. **PreCompact stdout is NOT injected as a slash command.** The claude-diary "echo `/diary`" trick relies on a mechanism not present in the documented contract — only SessionStart, UserPromptSubmit, and UserPromptExpansion accept stdout-as-context [1]. The diary pipeline likely works either because the hook shells out to `claude -p` directly or by relying on undocumented behavior.
3. **Stop fires every turn.** Wiring "end-of-session" capture to Stop means re-running on every assistant reply; this is correct for *incremental* per-turn extraction (claude-engram's model [2]) but wrong for single-shot capture without a debounce/cursor mechanism.
4. **PreCompact does NOT lose the on-disk transcript.** Compaction summarizes the *in-memory* conversation; the JSONL at `transcript_path` is append-only and survives compaction. So "PreCompact captures content that would be lost" is partly mythical — what is actually lost is the agent's in-context awareness, not the durable transcript. PreCompact is genuinely valuable as a crash-safety and incremental-checkpointing trigger, not because the transcript disappears.
5. **600 s is the real timeout for command hooks.** Several strategies justified detached background subprocesses against a "10 s timeout" that does not exist for SessionEnd/Stop/PreCompact. The actual ceiling is 10 minutes; detaching is still defensible for UX (don't block terminal close) but not for timeout reasons [1].
6. **Hooks cannot invoke Claude tools directly.** Command hooks are subprocess invocations with full filesystem access but no Read/Write/Edit/Bash tool surface. Doing LLM work from a hook means either (a) shelling out to `claude -p` (the 2bd-compatible pattern), or (b) calling the Anthropic API directly with the user's API key [1].

## Strategy catalog

Strategies grouped by *what* the memory artifact contains. Same source URL may appear in multiple groups when the project covers more than one capture mode.

### (a) Raw transcript snapshot

- **JSONL-to-trimmed-markdown converter** — Parse `~/.claude/projects/<slug>/<sessionId>.jsonl`, keep only `text` blocks (drop `tool_use`/`tool_result`/`thinking`), emit one `## User` / `## Claude` per turn. Zero LLM cost, faithful, grep-friendly [10].
- **Stable sortable filename `{date}-{slug}-{shortSessionId}.md`** — Idempotent overwrite on re-run, project-subdir layout for prefix grep, separate convention for subagent files (`-sub-{agentShortId}`) [10].
- **Cwd→project hashing/slugging** — `~/.claude/projects/` directories are slugs (path with `/` and `.` replaced by `-`), not hashes. Reversible from cwd; brittle against worktrees and subdir cd's [10].

### (b) Summarized session digest

- **SessionEnd briefing-cache pattern (Engram)** — On SessionEnd, do NOT extract; instead generate a <2000-char first-person briefing via Sonnet over the current memory bank, cache to `~/.engram/projects/<hash>/briefing-cache.json` with a memory-count stamp. SessionStart reads the cache for instant priming [2].
- **PreCompact as cursor-flush (Engram)** — Mid-session safety sweep: advance the transcript-read cursor through unread content so per-turn extraction doesn't miss the pre-compaction window. Pure file I/O, no LLM call [2].
- **`/diary` two-stage with `/reflect`** — `/diary` writes raw structured-template entries per session; `/reflect` runs later (manually or scheduled), aggregates N entries, applies 2+/3+ occurrence thresholds, promotes one-line imperative rules into CLAUDE.md and strengthens-in-place when violations recur [7].

### (c) Extracted lessons / deltas

- **Per-turn Stop-hook Haiku extraction with cursor** (Engram) — Stored byte-offset cursor reads only the new transcript slice since last call, Haiku extracts structured memory objects, bounded existing-memories window for dedup, append to JSON store [2].
- **Pairwise (m_{t-1}, m_t) extraction** (Mem0) — Runs on closed message pairs at end-of-turn, produces memory objects with content/metadata/score/timestamps, ADD-only storage with retrieval-time temporal+relevance ranking. LOCOMO 91.6, LongMemEval 94.8 [3].
- **Verbal self-reflection on failure trajectories** (Reflexion) — On detected failure signals (test fail, user pushback, self-correction), prompt: "You attempted X and failed because Y. Write a 1-2 sentence note for your future self." Stored separately, higher retrieval weight than raw memories. 91% pass@1 on HumanEval [5].
- **Quality-gated `ca learn` with NOVEL/SPECIFIC/ACTIONABLE checkboxes** (compound-agent) — `/diary`-style capture rejected unless the candidate insight passes three explicit criteria; user-confirmation required before commit [11].
- **Automatic trigger detection** (compound-agent) — Regex over recent user messages (`\bno\b[,.]?\s`, `\bwrong\b`, `\bactually\b`, `\bnot that\b`, `\bi meant\b`) plus 3-edit self-correction pattern and test-failure parsing. Detection only; content goes through downstream `ca learn` [11].
- **PostToolUseFailure hook with edit→fail→re-edit detection** (compound-agent) — `PostToolUseFailure` hook on `Bash|Edit|Write` tracks repeated failures and detects self-correction. Emits "consider searching memory" hint via `additionalContext`. Capture remains manual [11].

### (d) Structured memory blocks (typed records with lifecycle)

- **Git-tracked JSONL with deterministic IDs** (compound-agent) — Single `.claude/lessons/index.jsonl` source of truth, content-hash IDs (`{TypePrefix}{sha256(insight)[:16]}`), tombstones for deletion, `supersedes[]` chains, `invalidatedAt`/`invalidationReason`, `retrievalCount`+`lastRetrieved`, `compactionLevel`. Last-write-wins reduce by id at read time [11].
- **Type inference from insight text** (compound-agent) — Regex priority: pattern (`use … instead of`) → solution (`when …,`/`if … then`) → preference (`always …`/`never …`) → lesson default. L/S/P/R prefix for namespace separation. Pure-functional, no LLM call [11].
- **SQLite FTS5 + on-demand rebuild as derived index** (compound-agent) — JSONL durable, `.claude/.cache/lessons.sqlite` regenerated from JSONL by `ca rebuild`. Swappable for vector or other backend without touching source of truth [11].
- **OS-style tiered memory with explicit page tools** (MemGPT/Letta) — Main context (system + working + FIFO queue) vs external context (recall storage + archival storage). LLM itself calls `memory_insert`, `memory_search`, `archival_insert` — agent manages its own memory [6].
- **Pluggable memory primitives over composable stores** (LangChain LangMem) — Pattern library: ConversationBufferMemory, ConversationSummaryMemory, VectorStoreRetrieverMemory, EntityMemory, plus LangGraph `Store` keyed by namespace. No published benchmarks — toolbox not algorithm [12].

### (e) Knowledge graph / structured retrieval

- **Zettelkasten-style note linking with evolution-on-write** (A-MEM) — Each note stored with description, keywords, tags. New notes find related historical notes by similarity and (a) create explicit links, (b) trigger tag/description updates on older notes. Graph traversal at retrieval; outperforms MemGPT-style flat across 6 foundation models [13].
- **Bi-temporal knowledge graph** (Zep Graphiti) — Each edge carries `transaction_time` + `valid_time`; contradictions set old edge's `invalid_at` and insert new edge. Answers both "true now?" and "what did we believe last Tuesday?". 94.8% on Deep Memory Retrieval, +18.5% LongMemEval accuracy with 90% lower latency [14].
- **Temporal KG with hot/cold tiering driven by usage** (MemoryScope) — Hot tier always surfaced, cold retrieved on demand. Usage-driven re-weighting: retrieved edges stay hot, unused decay. LRU/LFU-style soft forgetting [15].
- **Reflection trees** (Generative Agents) — When cumulative importance crosses threshold (~150), agent asks LLM "3 most salient high-level questions about these statements?", answers each grounded in retrieved memories, stores as new higher-level nodes linked to evidence. Tree of abstractions [16].
- **Recency + Importance + Relevance retrieval score** (Generative Agents) — Score = 0.99^hours + importance/10 + cosine_sim. Importance rated 1-10 at write time via one-shot LLM call ("On the scale of 1 to 10... rate the importance"). Drop importance ≤ 2 [16].

### Cross-cutting plumbing strategies

- **CLAUDE_INVOKED_BY env var recursion guard** (compound-agent) — Spawned `claude -p` inherits env; child hook short-circuits if `CLAUDE_INVOKED_BY == 'flush'`. Required whenever capture pipeline itself invokes Claude [11][4].
- **60s dedup cooldown + content hash** (compound-agent) — `.flush-state.json` with `{last_ts, last_hash, last_session_id}`. Skip if `now - last_ts < 60s OR sha256(context) == last_hash`. Refuted as content-hash dedup against the full transcript (which grows monotonically — hash never matches) — needs to hash the *summary*, not the input [4].
- **Pgrep-gated concurrent-embed lock** (claude-qmd-sessions) — `pgrep -f 'qmd.*embed'` before kicking off the slow op; skip if running. Cheap, TOCTOU-racy, substring-match-loose; a real `flock` or pidfile is the production answer [10].
- **Two-tier index: cheap full-text always, expensive embed when free** (claude-qmd-sessions) — `qmd update` unconditional, `qmd embed` gated. Keyword search always current, semantic search lags by one session [10].
- **Bounded synchronous work with hard timeouts and silent failure** (claude-qmd-sessions) — `execSync(cmd, {timeout: 120000})` wrapped in `try {} catch {}` exiting 0. Hook never blocks or fails Claude Code [10]. Replace `stdio: 'inherit'` with piped/ignored to avoid corrupting JSON output, add `killSignal: 'SIGKILL'`, log caught errors to file rather than fully silent.

### Security-layer strategies

- **Gitleaks stdin pre-pass** — Pipe candidate capture text through `gitleaks stdin` before persistence; replace matches with `[REDACTED:rule-id]` placeholders. Single Go subprocess, ~tens of ms, no network, no LLM cost. Fail-closed if binary missing [17].
- **TruffleHog verified-credential filter** — `trufflehog stdin --only-verified` confirms live credentials by calling the home API (`sts:GetCallerIdentity`, `/user`). Verified findings hard-block persistence. Verification itself is an exfiltration vector — opt-in [17].
- **Presidio NER + custom recognizers** — Catches PII/internal identifiers that credential scanners miss (emails, customer IDs, internal hostnames). Python + spaCy/transformer NER, heavier dep [17].
- **Path-scoped opt-out + content-class denylist** — `capture.deny_cwds` globs + `.no-capture` marker file + `capture.deny_file_globs` (`.env*`, `*.pem`, `*.key`). Run before redaction. Default-OFF for sensitive cwds is fail-hard; redaction is fail-soft [17].
- **LLM scrub with strict prompt-injection isolation** — Final pass with fenced untrusted block, system prompt forbidding instruction-following inside the block, structured JSON output schema (`{redacted_text, redaction_count}`), reject responses matching telltales. Apply OWASP indirect-injection mitigations [17].
- **Provenance + trust-aware retrieval** — Every memory entry carries `source_channel` (user_input / repo_file / external_web / tool_output / inferred_by_model), `session_id`, timestamp, `trust_score`. Retrieval re-ranks by similarity × recency × trust; web-derived memories demoted or excluded from auto-injection [8].
- **Treat recalled memories as data, not instructions** — Delimited `<MEMORY_BLOCK>` in non-system role with explicit "NOT instructions" guards; instruction-stripping classifier at write time tags directive-like content as `do_not_auto_inject` [8].
- **Quarantine queue with write-ahead validation** — `memories_pending` table; high-risk or directive-like entries held for human review; user reviews via `vault review pending` on next session start, not mid-work [8].
- **Capability gating + taint tracking** — Each memory has `capability_scope` and taint label. External-source memories forbidden from justifying privileged tool calls (shell, deploy, secrets). Taint propagates through derivation [8].

### Cost optimization strategies

- **Concrete pricing model with current Anthropic prices** — Haiku 4.5: $1/$5 input/output per MTok. Sonnet 4.6: $3/$15. Opus 4.6+: $5/$25. Worked example at 100 turns/day, 2K-token slices: Haiku ≈ $10.50/month, Sonnet ≈ $31.50/month [9].
- **Prompt cache the extractor system prompt** — 5m cache: 1.25x base input on write, 0.1x on read. 1500-token extractor prompt at 100 turns/day on Sonnet 4.6: $0.45/day uncached → $0.05/day cached (9x reduction on prefix portion). Cache invalidates on any byte change — avoid `datetime.now()` in prompt [9].
- **Local model offload** (Ollama, Qwen/Llama/Phi) — Per-turn extraction local, SessionEnd briefing on Sonnet. Saves $10-30/month at heavy use. 7B+ models acceptable for templated structured extraction, weak for synthesis. Ollama 1-3s cold start, 50-300 tok/s [9].
- **Selective turn sampling** — Skip turns where `assistant_output_tokens < 50 OR tool_calls_only AND no_text_blocks OR no_file_writes AND no_decisions`. Cuts ~65% of turns; cost drops correspondingly. Always extract on TODO/FIXME, new file creation, explicit "remember this" phrasings [9].
- **Buffer N turns and batch-dispatch** — Buffer to JSONL, trigger every 5 turns or 2 min idle. Amortizes per-call overhead and improves cache hit rate. For SessionEnd briefings tolerating 10min-24h delay, use Anthropic Batch API for flat 50% discount [9].

### Evaluation strategies

- **End-to-end A/B agent test** (memory-off vs memory-on) — Same agent on identical multi-session episodes; measure task success, tool-call count, wall-clock time, token cost, human-rated quality. Paired Wilcoxon over per-episode scores. Only method that directly answers "did the user get more done?" [18].
- **Held-out should-have-recalled corpus** — Label golden memory events, craft later-session queries where those facts should surface, compute Recall@K and Precision@K. LongMemEval-style harness [18].
- **Staleness harm index** — Paired refactor scenarios: capture in Session A, refactor offline, run Session B. Measure staleness application rate, harm severity (test failures, broken builds), update latency [18].
- **Public benchmarks**: LongMemEval-S (500 questions), LOCOMO (multi-session reasoning), MemoryBench (episodic recall) for external comparability [18].
- **Poisoned memory robustness** — Plant prompt-injection payloads in inputs; measure storage rate, retrieval rate, override rate, time-to-purge as a function of TTL/decay [18].

## Prior art table

| Tool / Repo | Hook used | What captured | Where written | Format | Read-back path | URL |
|---|---|---|---|---|---|---|
| **claude-memory-compiler** (Cole Medin) | SessionEnd + PreCompact (mirrored) | Last ~30 turns / 15K chars tail; LLM-extracted decisions/lessons/patterns/gotchas with FLUSH_OK sentinel | `daily/YYYY-MM-DD.md` raw; `knowledge/concepts/*.md`, `knowledge/connections/*.md`, `knowledge/qa/*.md`, `knowledge/index.md` compiled | Markdown + YAML frontmatter; AGENTS.md schema; `state.json` content-hash dedup | SessionStart hook injects `knowledge/index.md` (one-line summaries); model uses Read to fetch full articles | [4] |
| **claude-engram** | Stop (per-turn) + PreCompact (cursor-flush) + SessionEnd (briefing-cache, reset cursor) | Per-turn Haiku extraction with byte-offset cursor; bounded dedup window; importance/relevance/novelty/emotional-weight scored | JSON memory store; `briefing-cache.json` with memory-count stamp | Structured JSON entries; decay (decay_rate × √age_days) with 0.03 prune floor; sleep-cycle consolidation merges redundants | SessionStart reads cached briefing; falls back to live generation if missing | [2] |
| **claude-diary** (rlancemartin) | PreCompact `echo "/diary"` (slash-command trick) | `/diary` writes full structured-template entries per session; `/reflect` aggregates with 2+/3+ frequency thresholds | `~/.claude/memory/diary/YYYY-MM-DD-session-N.md` raw; `~/.claude/memory/reflections/YYYY-MM-reflection-N.md`; CLAUDE.md gets promoted one-line imperatives | Markdown with fixed sections (Task Summary, Design Decisions w/ WHY, User Preferences, Code Patterns); `processed.log` tracks reflections | CLAUDE.md is always loaded; reflections are reference; `/refresh` slash command for manual re-injection of last ~50 exchanges | [7] |
| **claude-qmd-sessions** (wbelk) | SessionEnd + PreCompact (dual-event) | Raw JSONL→trimmed markdown (strip tool_use/tool_result/thinking); zero-extra-token | `<outputDir>/<project>/<date>-<slug>-<shortSessionId>.md` (subagents: `-sub-<agentShortId>`) | Markdown sections (## User / ## Claude); SQLite FTS keyword + vector index via `qmd embed` | SessionStart injects `collectRecentTurns(maxTurns=100, maxChars=14000)` from same-project files first via `hookSpecificOutput.additionalContext` | [10] |
| **compound-agent** (Nathandela) | SessionStart + PreCompact (prime) + UserPromptSubmit (relevant recall) + PostToolUseFailure (failure tracking) | `ca learn` manual + quality-gated (novel/specific/actionable); regex trigger detection | `.claude/lessons/index.jsonl` (git-tracked, append-only) + `.claude/.cache/lessons.sqlite` (FTS5 derived) | JSONL with deterministic content-hash IDs (L/S/P/R prefix), tombstones, supersedes chains, retrievalCount, invalidatedAt | `prime` command prepends trustLanguage protocol + top-N ranked by severity*recency*confirmation; injected via SessionStart `additionalContext` | [11] |
| **Mem0** | Per-turn extraction on closed message pairs (Stop equivalent) | Pairwise (m_{t-1}, m_t) LLM extraction → memory objects with content/metadata/score/timestamps | Layered tiers: conversation → session → user → organization, with promotion rules | ADD-only structured records; contradictions resolved at query time via temporal + relevance ranking | Tiered retrieval: user > session > raw history; LOCOMO 91.6, LongMemEval 94.8 | [3] |
| **Zep / Graphiti** | API-driven (not Claude Code hook-specific) | LLM-extracted entities + relations from messages; bi-temporal edges | Neo4j/FalkorDB temporal knowledge graph | Edges with `transaction_time` + `valid_time` + `invalid_at` for supersession | Graph traversal + vector search over node/edge embeddings; DMR 94.8%, +18.5% LongMemEval | [14] |
| **Letta / MemGPT** | Agent-tool-driven (LLM calls memory tools itself) | LLM-decided promotions: `core_memory_append`, `core_memory_replace`, `archival_memory_insert` | Main context (in-prompt: system + working + FIFO) vs external (recall + archival storage) | Typed memory pages (user_profile, persona, notes); LLM swaps pages under fixed context budget | LLM issues `memory_search` / `archival_memory_search` tool calls during reasoning | [6] |
| **A-MEM** | API-driven | LLM-generated {description, keywords, tags} per note; evolution-on-write triggers updates to related notes | Graph of interconnected notes with bidirectional links | Note records with link-store; tags can evolve as project vocabulary shifts | Similarity retrieval + 1-hop link expansion before ranking; outperforms flat MemGPT-style across 6 foundation models | [13] |
| **LangChain LangMem** | API-driven (framework, not opinion) | User-configured: ConversationBufferMemory / SummaryMemory / VectorStoreRetrieverMemory / EntityMemory | LangGraph `Store` (namespaced) or arbitrary backend | Pluggable — no opinion on schema | User-configured retrieval and injection | [12] |
| **Generative Agents** (Park et al. 2023) | N/A (research prototype, not Claude Code) | All observations + LLM-generated reflections (when importance sum > ~150) | Memory stream with embeddings + importance scores | Reflection trees: leaves are observations, internal nodes are LLM-answered "salient questions" linked to evidence | Top-k by `recency(0.99^hours) + importance/10 + cosine_sim` — the canonical retrieval formula | [16] |

## Adversarial findings

### Technical feasibility lens (against documented hook contract)

**Strongest refutations:**

- **"Echo `/diary` from PreCompact" is contradicted by the documented hook contract.** PreCompact stdout goes only to debug log; only SessionStart/UserPromptSubmit/UserPromptExpansion inject stdout-as-context [1]. The claude-diary mechanism must work via direct `claude -p` shell-out, not via the printed-command trick — the strategy as described is refuted.
- **SessionEnd-based "guarantees flush on exit" is overstated.** SessionEnd does not fire on SIGKILL, crash, OS shutdown, or some `/clear` paths. PreCompact also misses sessions that never compact. The dual-event pattern raises coverage materially but does not eliminate loss [1][4][10].
- **The "10s timeout" justification for detached subprocesses is factually wrong.** SessionEnd, Stop, and PreCompact command-hooks default to 600s, not 10s. Detaching is still defensible for terminal-close UX, but not for timeout reasons [1].
- **Hooks cannot invoke Claude tools.** Strategies that imply the hook itself runs LLM extraction must specify a subprocess (`claude -p`) or API call path — and those imply credential management the strategies typically don't address [1].
- **`pgrep -f 'qmd.*embed'` substring matching is loose.** Matches `vim qmd_embed.py`, `grep qmd embed`, and even the hook's own argv. Production needs `flock` or atomic pidfile creation [10].
- **`$PWD` is the wrong cwd primitive in hooks.** The stable signal is the `cwd` field in stdin JSON or `CLAUDE_PROJECT_DIR` env var — `$PWD` is brittle if Claude Code spawn cwd ever shifts [1][10].
- **Worktrees fragment cwd→project mapping silently.** A worktree at `.../2bd-cli/.claude/worktrees/patched-zone-f8ce` resolves to a completely separate `~/.claude/projects/` bucket from the main repo. Same project, different bucket, history split [10].

### Signal-to-noise lens (will this actually capture useful memory?)

**Strongest refutations:**

- **Capture-without-extraction is the dominant failure mode.** Strategies that write raw transcripts (claude-qmd-sessions, the `/diary` half alone, "SessionStart context-restore from converted markdown") accumulate verbose journals nobody reads by ~100 sessions. At 10 sessions: tolerable. At 100: signal density collapses, retrieval returns dense clusters of the same paraphrased fact, and reverse-chronological windows actively *invert* the desired ratio by evicting durable old lessons in favor of recent chatter [10][2][7].
- **"Lesson learned vs. thing that happened" is rarely enforced by the schema.** Most strategies push this distinction onto an LLM prompt without negative examples, durability criteria, or "save nothing" escape valves. The pull of structured templates ("Decisions / Lessons Learned / Action Items" slots) generates lessons by template-pressure regardless of whether the session produced any [7][4].
- **Semantic dedup is almost universally absent.** Exact-hash dedup catches re-runs against the same input; it doesn't catch "remember to check for null" / "always null-check inputs" / "validate args are non-null". The same lesson rediscovered N times becomes N entries that all rank similarly at retrieval, drowning new signal. Mem0's bounded dedup window is judgment-based not deterministic; compound-agent's NOVEL checkbox is self-graded by the same model that just proposed the entry [4][11][3].
- **Frequency thresholds reward common-but-shallow, under-weight rare-but-critical.** The `/reflect` 2+/3+ rule promotes "user prefers pnpm" (came up three times) and silently drops the one-shot security gotcha. Without importance-weighted scoring (Generative Agents-style), durable lessons sink [7][16].
- **One-way strengthening produces ALL-CAPS rot.** "ZERO TOLERANCE" → "ABSOLUTE ZERO TOLERANCE" → "overrides ALL defaults INCLUDING X, Y, Z" — emphasis inflation has a known failure mode where once 5+ rules carry it, none carry it. No published strategy includes an emphasis budget [7].
- **Decay alone leaves a lukewarm middle.** Engram's `decay_rate × √age` with 0.03 prune floor clears the tail and keeps the recent — but mid-strength stale memories accumulate, neither duplicate enough to merge nor weak enough to prune [2].
- **Append-only journal + LLM-judgment dedup degrades at scale.** Works at 50 articles, falters at 500, breaks at the documented ~2000 article ceiling where `index.md` no longer fits in context [4]. The fallback "switch to RAG" concedes the core premise.

### Fit-for-2bd lens

**Strongest refutations:**

- **Several strategies bring Python/`uv`/Go dependencies into a Bun+TS codebase.** Mechanical, but a real "this needs porting" cost the strategies typically elide. None of the disqualifying infra (vector DB, MCP server, daemon, multi-process IPC) is required for the *strategies themselves* — only for some of their accidental implementations.
- **2bd has no SessionEnd hook today.** Most strategies assume one exists. Wiring it is a one-line addition to `src/cli.ts` plus a sibling file to `src/hooks/session-start.ts`, but it is genuine new code, not a port.
- **2bd has no transcript reader.** The single most consistent gap. Reading Claude Code's JSONL transcripts (parsing tool_use/tool_result blocks, handling isSidechain subagent turns, redaction) is non-trivial new code and depends on an undocumented Claude Code internal format.
- **2bd has no persistent state directory.** Cursors, dedup hashes, content-hash IDs, `processed.log`, briefing caches — all imply a state surface that doesn't exist. Cleanest location is `.2b/state/` (gitignored), but this is the first piece of mutable 2bd-owned state in the codebase.
- **2bd's `claude -p` subprocess pattern is great for one-shot LLM work but exposes recursion risk.** A Stop hook that spawns `claude -p` starts another Claude session that itself fires Stop hooks on completion. Requires a `CLAUDE_INVOKED_BY` (or namespaced `TWOBD_FLUSH_IN_PROGRESS`) env var sentinel — not in any strategy as written [11][4].
- **The "discovered MOC" pattern in 2bd already implements the right shape for read-back.** SessionStart already concatenates `.2b/system/*.md` and walks MOC frontmatter via `assembleContext` — adding a single-line summary index of captured memories slots in as one more category, with no new patterns needed.

### Survival across all three lenses

Patterns that hold up under all three:

1. **Two-stage capture-then-compile** (claude-memory-compiler shape, claude-diary `/diary`+`/reflect` shape). Cheap append-only per-session capture + separate compile/distill pass into a small always-loaded surface [4][7].
2. **Per-turn Stop-hook extraction with cursor + SessionEnd as briefing-cache only** (Engram shape). Avoids the "session crashed before SessionEnd fired" failure mode of single-shot designs; SessionEnd becomes a SessionStart-acceleration optimization rather than the critical capture path [2].
3. **Pairwise (m_{t-1}, m_t) extraction** (Mem0 shape). Closed message pairs at end-of-turn produce structured memory objects with content/metadata/score/timestamps; ADD-only storage with retrieval-time temporal ranking. Best-published benchmark numbers (LOCOMO 91.6, LongMemEval 94.8) [3].
4. **Recency + Importance + Relevance retrieval score** (Generative Agents canonical). Store importance once at write time (cheap one-shot LLM call), combine with cosine_sim and 0.99^hours at read time. Drop importance ≤ 2 entries at write time. The three signals cover orthogonal failure modes (recent-but-irrelevant, important-but-stale, similar-but-trivial) [16].
5. **Provenance + trust-aware retrieval as foundation layer.** Required precondition before any of the other security strategies can be enforced. Maps cleanly onto a YAML frontmatter convention 2bd already uses [8].

## Recommendations for 2bd

The current 2bd hook (`session-start.ts` → `assembleContext` → `buildHookOutput`) already implements the right end-state pattern: read structured markdown, emit `additionalContext` JSON. The capture system should be a symmetric write-side, plus a compile step that produces material `assembleContext` already knows how to read.

### 1. Which hook event to use, and why

**Primary: `Stop` hook for per-turn incremental extraction. SessionEnd as flush-and-briefing-cache backstop. SessionStart unchanged for read-back. PreCompact only if/when sessions routinely run long enough to auto-compact.**

Justification:
- SessionEnd cannot inject context and does not fire on crash/kill — it is the wrong primary capture point [1]. Its actual role is "do anything that should happen exactly once at the end and persist to disk for the next session."
- Stop fires every turn, has a 600s timeout, supports `additionalContext` feedback, and produces incremental signal that survives crashes [1][2]. Per-turn extraction is what claude-engram and Mem0 both converge on independently [2][3].
- PreCompact is a safety sweep for long sessions but undocumented for short sessions. Adding it as a secondary trigger that shares the Stop extractor's code path is essentially free.

### 2. Whether the hook should invoke `claude -p` or just persist raw data

**Stop hook: persist raw turn slice (fast, synchronous). Spawn `claude -p` for extraction in detached background subprocess. SessionEnd: invoke `claude -p` for briefing synthesis (synchronous, accept the latency since user is leaving).**

Justification:
- The Stop hook fires every turn; making the user wait 1-3s for Haiku on every Enter is user-hostile.
- Bun.spawn with `stdio: "ignore"` + `.unref()` detaches cleanly on macOS/Linux; on Windows use `node:child_process.spawn({detached: true, stdio: 'ignore'}).unref()` [2][9].
- Set `TWOBD_FLUSH_IN_PROGRESS=1` (namespaced to avoid colliding with Claude Code internals) in the child env to prevent recursion when the child's own Stop hook fires [11][4].
- For the briefing/compile step at SessionEnd, accept the synchronous LLM call — session is ending anyway, and SessionStart on next launch reads a pre-baked file [2].
- Selective sampling gate before spawn: skip turns where `assistant_output < 50 tokens && no_file_writes && no_decisions` [9]. Cuts ~65% of LLM cost.

### 3. Minimum viable schema for a captured-session record

Two layers, mirroring the claude-memory-compiler / `/diary`+`/reflect` pattern:

**Layer 1 — Raw daily log** (`.2b/state/daily/YYYY-MM-DD.md`, gitignored):

```markdown
## Session: <session_id> · <HH:MM>

**Context:** <cwd, branch if available>

**Trigger turns** (only turns flagged by the sampling gate):
- T+05:32 [trigger: file_write] <one-line summary>
- T+12:18 [trigger: user_correction] <one-line summary>

**Decisions:**
- ...

**Open threads:**
- ...
```

**Layer 2 — Compiled lessons** (`.2b/system/lessons/<slug>.md`, git-tracked, vault-native), one file per durable lesson, with YAML frontmatter:

```yaml
---
id: L<sha256(insight)[:16]>
type: lesson | solution | pattern | preference
trigger: "Self-correction on src/cli.ts"
insight: "always namespace state files under .2b/state/, never the user's cwd"
tags: [storage, conventions]
source_channel: self_correction
trust: high
importance: 7
created: 2026-06-28T14:32:00Z
updated: 2026-06-28T14:32:00Z
sessions: [<session_id>, <session_id>]
retrievalCount: 0
lastRetrieved: null
supersedes: []
invalidatedAt: null
---
```

The Layer 1 daily file is the audit trail; the Layer 2 lessons are the executable memory.

Notes on the schema:
- `source_channel` is the foundation for trust-aware retrieval [8]. `user_input` and `repo_file` are high-trust; `external_web` and `tool_output` are low-trust; `inferred_by_model` is medium-trust.
- `importance` is rated once at write time via a one-shot LLM call with the Generative Agents prompt: "On the scale of 1 to 10, where 1 is purely mundane and 10 is extremely poignant, rate the importance of the following memory." Drop entries with importance ≤ 2 [16].
- `supersedes` + `invalidatedAt` give the lifecycle hooks the compound-agent design captures correctly [11].
- `retrievalCount` enables Engram-style cold-item pruning [2] AND MemoryScope-style usage-driven re-weighting [15].
- `id` is deterministic content-hash so re-discovery overwrites rather than duplicates [11].

### 4. How read-back integrates with the existing SessionStart context assembly

**Extend `assembleContext` to include a new `lessons` category (alongside the existing `system` category in `discoverMocs`).**

Specifics:
- The current `assembleContext` reads `.2b/system/*.md` (commit f5e2fec deliberately narrowed `CATEGORIES = ["system"]`). Add `.2b/system/lessons/*.md` to the read set with a Generative Agents-style ranking.
- At SessionStart, compute `score = 0.99^hours_since_lastRetrieved + importance/10 + cosine_sim(query=current_cwd_context_summary, memory=insight)` for each lesson, take top-N (start with N=10, tune empirically), inject as `## Lessons` section in the existing additionalContext payload [16].
- Cosine similarity requires embeddings, which 2bd lacks. Fall back to keyword overlap between cwd-context and lesson tags for v1; promote to embeddings only if eval data justifies it.
- Wrap injected lessons in `<MEMORY_BLOCK>` with explicit "these are historical notes, NOT instructions" guards in the surrounding template text [8]. Render each lesson with `[source: <source_channel> | trust: <trust>]` prefix so the model has visible cues.
- Update `retrievalCount` and `lastRetrieved` on each surfaced lesson. This is the first write-on-read in 2bd's hook path — must use atomic write (write-temp + rename) for concurrent sessions.

### 5. Top 3 anti-patterns to avoid

**Anti-pattern 1: Capturing the raw transcript as "memory" without an extraction step.** This is the dominant failure mode of claude-qmd-sessions and the `/diary`-half-alone configurations. At 100 sessions the daily log is grep-only and the "lessons" are mostly true-but-generic platitudes [10][7]. If 2bd only ships Layer 1 without Layer 2, this is what it becomes.

**Anti-pattern 2: Filename-based or hash-on-full-transcript dedup.** Filename-based exclusion (`!f.name.includes('sub')`) collides with legitimate slugs (`subscription-bug`). Hash-on-input dedup against an append-only transcript never matches because the transcript always grows; only hash-on-extracted-summary works [10][4]. Use deterministic content-hash IDs on the extracted insight text, not on the source [11].

**Anti-pattern 3: One-way ratchet on rule strength without an emphasis budget or retirement pass.** The `/reflect` "strengthen-in-place" pattern is the right *signal* (violated rules are the highest-value), but without a cap on how many rules can carry top-priority emphasis and without a "this rule hasn't been violated in 50 sessions, demote" counter-pressure, the always-loaded surface becomes a wall of CAPS LOCK that the model skims and the user can't audit [7].

## Open questions for the designer

1. **What is the scope of "session" — single Claude Code invocation, or a logical task that may span multiple invocations across days?** 2bd has no concept of task continuity today; if memory is per-invocation, then a multi-day refactor produces N disjoint captures and the compile step has to stitch them. If memory is per-task, what marks task boundaries — explicit user command, working-directory-and-branch tuple, or LLM-judged continuity?

2. **Who owns the cost decision — does the user opt into per-turn extraction, or is it default-on?** At 100 turns/day, Haiku 4.5 per-turn is ~$10.50/month; that's a meaningful spend to add without consent. Is there a tier (zero-cost regex-only extraction → Haiku → Sonnet → local Ollama) the user chooses, or does 2bd pick a default?

3. **What is the read-back trust model when lessons originate from `claude -p` (which might have read external sources)?** Anything Claude wrote could trace through a WebFetch or a pasted README. Does 2bd default trust the model's self-extraction, or does it taint everything not explicitly tagged by the user?

4. **Where does the compile/distill step live, and when does it run?** Options: (a) inline at SessionEnd (slow), (b) detached background after SessionEnd (race-prone, no supervisor), (c) explicit `2bd compile` user command (manual, user forgets), (d) lazy at SessionStart when daily log mtime > lessons mtime (slow first session of the day), (e) cron-shaped scheduled. claude-memory-compiler picks (e); claude-diary picks (c). 2bd has no scheduler — which trade-off is acceptable?

5. **Should captured memory be project-local or user-global?** 2bd's vault is project-local (`.2b/` lives in the repo). Cross-project lessons ("always pin Node version") naturally belong global; project-specific lessons ("this repo uses pnpm") naturally belong local. Two-tier storage or all-local with a `scope: global` frontmatter field?

6. **How does the system surface "memory was suppressed" to the user?** If the path-scoped denylist or quarantine queue silently skips a session, the user sees nothing — leaks of opt-in capture surface as "the memory system doesn't work, why bother." What's the lightweight notification path that doesn't add yet another interactive prompt?

7. **What's the eval rig?** Without an A/B test of "memory-off vs memory-on", a should-have-recalled corpus, or at minimum a staleness-harm scenario, 2bd has no way to know if the memory layer helps. Is the design willing to commit to a small (~20 episode) eval corpus from day one, or accept the system ships on intuition?

8. **What's the migration path if the format changes?** The compound-agent strategy explicitly handles legacy `quick`/`full` → `lesson` type migration via JSONL edits + `rebuild`. 2bd's YAML frontmatter approach makes schema changes easier than JSONL but still requires a "migrate vault" command. Should this exist on day one, or is "delete `.2b/system/lessons/` and re-build over a few sessions" acceptable?

## Sources

[1] Anthropic. "Hooks reference." Claude Code documentation. https://code.claude.com/docs/en/hooks

[2] mlapeter. "claude-engram." GitHub. https://github.com/mlapeter/claude-engram

[3] Chhikara et al. "Mem0: Building Production-Ready AI Agents with Scalable Long-Term Memory." arXiv:2504.19413. https://arxiv.org/abs/2504.19413

[4] coleam00. "claude-memory-compiler." GitHub. https://github.com/coleam00/claude-memory-compiler

[5] Shinn et al. "Reflexion: Language Agents with Verbal Reinforcement Learning." arXiv 2023. (Referenced via the generative-agents survey at https://arxiv.org/abs/2304.03442)

[6] Packer et al. "MemGPT: Towards LLMs as Operating Systems." arXiv:2310.08559. https://arxiv.org/abs/2310.08559 (Letta docs: https://docs.letta.com)

[7] rlancemartin. "claude-diary." GitHub. https://github.com/rlancemartin/claude-diary

[8] Schneider, Christian. "Persistent Memory Poisoning in AI Agents." https://christian-schneider.net/blog/persistent-memory-poisoning-in-ai-agents/

[9] Anthropic. "Pricing." Claude Platform documentation. https://platform.claude.com/docs/en/about-claude/pricing

[10] wbelk. "claude-qmd-sessions." GitHub. https://github.com/wbelk/claude-qmd-sessions

[11] Nathandela. "compound-agent." GitHub. https://github.com/Nathandela/compound-agent

[12] LangChain. "LangGraph persistence — Memory Store." https://langchain-ai.github.io/langgraph/concepts/persistence/#memory-store

[13] Xu et al. "A-MEM: Agentic Memory for LLM Agents." 2025. (Referenced in https://arxiv.org/abs/2504.19413)

[14] Zep / getzep. "Graphiti — temporal knowledge graph engine." https://github.com/getzep/graphiti

[15] Alibaba. "MemoryScope." (Referenced in https://arxiv.org/abs/2504.19413)

[16] Park et al. "Generative Agents: Interactive Simulacra of Human Behavior." arXiv:2304.03442. https://arxiv.org/abs/2304.03442

[17] Multiple: gitleaks (https://github.com/gitleaks/gitleaks), trufflehog (https://github.com/trufflesecurity/trufflehog), Microsoft Presidio (https://github.com/microsoft/presidio), OWASP LLM Top 10 — Indirect Prompt Injection (https://genai.owasp.org/llmrisk/llm01-prompt-injection/), Claude Code hooks (https://code.claude.com/docs/en/hooks).

[18] rohitg00. "agentmemory — evaluation harness." GitHub. https://github.com/rohitg00/agentmemory