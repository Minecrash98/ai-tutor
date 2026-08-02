# Repository review guide

## Fastest review path

1. README.md — product summary, run commands, machine baseline, data handling,
   and honest limitations.
2. MVP_SPEC.md — the frozen learner workflow and acceptance criteria.
3. ARCHITECTURE.md — system boundaries, runtime isolation, persistence, and
   Realtime design.
4. docs/RESULTS_AND_LIMITATIONS_2026-08-02.md — measured evidence, known gaps,
   and claims the project refuses to make.
5. COMPETITION_FIRST_PLACE_GOALS.md — the auditable 100-item status ledger.

## Core implementation

| Exact path | What it contains | What it demonstrates |
|---|---|---|
| apps/web/src/features/canvas/CanvasWorkspace.tsx | Canvas and teaching-block orchestration | The learner works with live pages, lessons, source, and evidence on one visual surface |
| apps/web/src/features/canvas/TeachingBlockShape.tsx | Interactive tldraw teaching block | Runtime previews are first-class canvas objects rather than screenshots |
| packages/runtime-static-html/src/normalization.ts | Static project normalization | Imported HTML/CSS is converted into a deterministic project model |
| packages/runtime-static-html/src/sandbox-document.ts | Sandboxed document construction | Uploaded scripts do not execute |
| packages/runtime-static-html/src/inspection-bridge.ts | Versioned host/iframe messages | Element inspection and style updates cross a constrained protocol |
| packages/runtime-static-html/src/runtime.ts | Runtime lifecycle | Preview mount, update, inspection, and disposal are explicit |
| apps/web/src/features/lesson/box-model-lesson.ts | Box-model reducer | The first vertical learning loop is deterministic and replayable |
| apps/web/src/features/lesson/scenario-lesson.ts | Flex and positioning reducers | The same teaching contract generalizes to more CSS concepts |
| apps/web/src/features/lesson/personalized-course.ts | Source-grounded course derivation | An imported page can become a minimal lesson and transfer task |
| apps/web/src/features/tutor/teaching-facts.ts | Bounded page facts | Tutor explanations are based on selected source and runtime evidence |
| apps/web/src/features/tutor/tutor-tool-executor.ts | Tool permission and execution | AI requests cannot bypass the approved teaching tool boundary |
| apps/web/src/features/tutor/use-realtime-tutor.ts | Realtime client state machine | Text, voice, recovery, and fallback states are explicit |
| packages/contracts/src/realtime.ts | Versioned Realtime contracts | Client/server events are validated and auditable |
| packages/contracts/src/learning-proof.ts | Versioned evidence contracts | Lesson and audit events share strict typed envelopes |
| apps/web/src/features/learning/LearningProofReplay.tsx | Interactive replay UI | Judges can inspect the learning timeline step by step |
| apps/web/src/features/learning/server/learning-proof-store.ts | PostgreSQL event/snapshot store | Owner, sequence, hash, idempotency, and snapshot integrity are authoritative |

## Tests and evidence

| Exact path | What it demonstrates |
|---|---|
| tests/e2e/source-editor.spec.ts | Safe preview, editor validation, immutable save, and comparison |
| tests/e2e/personalized-course.spec.ts | Imported-source grounding and frozen transfer task |
| tests/e2e/learning-proof.spec.ts | Local and authoritative replay behavior |
| tests/e2e/realtime-boundary.spec.ts | Realtime capability and fallback boundaries |
| tests/e2e/p8-grounding-tools.spec.ts | Evidence-gated teaching claims |
| tests/e2e/p8-failure-matrix.spec.ts | Recovery from database, network, and capability failures |
| tests/e2e/p8-security.spec.ts | Upload and runtime security boundaries |
| tests/e2e/p8-accessibility.spec.ts | Automated keyboard, axe, and preference checks |
| tests/e2e/p8-performance.spec.ts | Frozen short-run performance budgets |
| tests/e2e/p8-visual.spec.ts | Seven fixed visual regression scenes |
| docs/P8_LEARNING_PROOF_REPLAY_ACCEPTANCE_2026-08-03.md | Unified replay machine acceptance |
| evidence/P8_RELEASE_MANIFEST_2026-08-02T18-39-13-438Z.json | Hash-bound local release inputs and images |

## Run

~~~text
pnpm install --frozen-lockfile
pnpm preflight
pnpm dev
~~~

Open http://127.0.0.1:3000.

Full local baseline:

~~~text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm test:e2e
~~~

Production-style local stack:

~~~text
docker compose up -d --build
docker compose exec -T web /nodejs/bin/node /app/scripts/container-health-check.mjs
pnpm test:e2e:compose
~~~

## Mocked, incomplete, and external

- Synthetic microphone tracks are used only for isolated protocol tests; they
  are not presented as human voice-quality evidence.
- Realtime Live paths depend on an authenticated local Codex app-server and
  are skipped when that capability is unavailable.
- Deterministic lessons and text fallback work without that external service.
- The product shell is currently Chinese; full interface internationalization
  is incomplete.
- No unfamiliar learner study, expert review, human screen-reader study,
  public deployment, legal review, or independent final go/no-go exists.
- No valid current-source 30-minute soak exists because the rerun was waived.
- Do not add passwords, API keys, OAuth files, .env secrets, personal data, or
  raw participant records to the public repository.
