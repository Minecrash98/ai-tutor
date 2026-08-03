# Repository review guide

## Fastest review path

1. README.md — product promise, five-minute learning loop, run commands, and
   the implementation map.
2. docs/submission/FULL_WRITEUP.md — the competition narrative, final evidence,
   current operating scope, and next product milestones.
3. apps/web/src/features/canvas/CanvasWorkspace.tsx — the live canvas,
   imports, lesson orchestration, and Tutor-created controls.
4. apps/web/src/features/tutor/server/codex-realtime-provider.ts — the live
   Tutor's teaching behavior and bounded tool policy.
5. packages/runtime-static-html/src/ — the script-free runtime and versioned
   bridge behind the learning canvas.
6. tests/e2e/ — real-browser coverage of the main path, recovery, accessibility,
   security, and failure behavior.

## Core implementation

| Exact path | What it contains | What it demonstrates |
|---|---|---|
| apps/web/src/features/canvas/CanvasWorkspace.tsx | Canvas and teaching-block orchestration | The learner works with live pages, lessons, source, and evidence on one visual surface |
| apps/web/src/features/canvas/TeachingBlockShape.tsx | Interactive tldraw teaching block | Runtime previews are first-class canvas objects rather than screenshots |
| apps/web/src/features/canvas/runtime-project-context.tsx | CSS control, preview, save, and comparison state | A Tutor-created :root --brand control changes the live page and creates an immutable version |
| apps/web/src/features/canvas/EnglishDemoPresentation.tsx | English submission presentation path | Dynamic interface text, form values, attributes, and Tutor actions stay English during the demo |
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

## Operating requirements and demo boundaries

- The final demo uses scripted student prompts for repeatability and an
  authenticated live Tutor for all Tutor responses and tool actions.
- Isolated browser automation uses a generated silent microphone track and
  muted local playback. The physical microphone is never opened.
- Realtime voice and text require an existing authenticated local Codex
  app-server session. Deterministic lessons and fallback tutoring run without
  that service.
- The product includes English and Chinese presentation paths. A first-class
  learner-facing language switch is the next localization milestone.
- Local and Docker evaluation are implemented. A public commercial release
  would add hosted authentication, rate limiting, observability, retention
  controls, and applicable production licenses.
- Current evidence establishes implemented behavior and engineering quality.
  Learner transfer, retention, expert rubric, and human screen-reader studies
  are the next research layer.
- Never commit passwords, API keys, OAuth files, .env secrets, browser
  profiles, personal data, or raw participant records.
