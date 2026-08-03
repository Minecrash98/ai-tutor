# AI Tutor — Full write-up

## The problem and our approach

CSS is visual, yet beginners often learn from disconnected snippets or chat
answers. A learner can reproduce a target screenshot without understanding
what caused it. Generic assistants optimize for completion; AI Tutor asks
learners to predict, test, explain, and transfer.

AI Tutor turns a learner's real page into a visual practice space. The core
loop is Predict–Observe–Explain–Transfer: first make a prediction, then change
one controlled value, observe the rendered result, explain the cause using
page facts, and finally solve a related task on a different page. The current
prototype includes deterministic lessons for box model, Flex, and positioning,
plus a personalized path generated from imported HTML and CSS.

Imported files are normalized, scripts are removed, and the result runs in a
sandboxed iframe behind a versioned bridge. A learner can select an element,
inspect the relevant source and computed style, adjust CSS with immediate
transient feedback, safely run the edit, and save an immutable version. The
five-minute demo follows a student who asks the Tutor to test a prediction,
checks the source, changes --brand once, and returns with evidence. The Tutor
answers twice with concrete checks instead of taking over the edit. Buttons,
labels, borders, and code highlights update together; a complete mint palette
is then saved and compared with the original purple version.

The optional Realtime Tutor is constrained by page-grounded tools. It can read
the selected element, relevant source, the learner's last action, and teaching
assertion evidence. If evidence is missing or insufficient, the runtime
replaces a causal claim with uncertainty instead of inventing an explanation.
Text and deterministic lessons remain available when Realtime, an account, the
network, or microphone access is unavailable.

Learning Proof is a versioned event timeline, not a celebratory score. It
replays lesson events, tutor states, tool results, fact receipts, and learner or
AI canvas saves. PostgreSQL verifies ownership, sequence, hashes, idempotency,
and snapshots. Without content-storage opt-in, message text remains null and
replay says it was not saved.

## Evidence, experiments, and user testing

The latest local baseline passed lint, type checking, production build, and 239
automated tests with 10 honest account-dependent skips. Isolated Chromium
passed 67 cases with 18 Live skips; production-style Compose passed 25/25
against real PostgreSQL. Other machine suites covered browsers, touch,
accessibility, failure, security, and visual states. The demo separately
records a real authenticated text session with two student turns and two Tutor
responses; it is product evidence, not learning-outcome evidence.

A controlled performance run used 21 runtimes and 53 teaching blocks. Import
P95 was 340 ms, pointer-frame P95 was 16.8 ms, and 47 drag-preview samples had
a 23.3 ms P95. The authoritative workspace was written once after release.
These figures describe one isolated local machine.

Human testing has not happened: zero unfamiliar learners, experts, or human
screen-reader participants have completed a formal study. The repository
therefore makes no claim that AI Tutor improves learning outcomes. Automated
tests demonstrate implemented behavior and reproducibility, not pedagogy.

## Constraints, limitations, and incomplete areas

The recording uses a query-scoped English presentation mode over the current
interface; a complete multilingual product and learner-facing language switch
are not finished. Realtime depends on an existing local Codex app-server OAuth
session; deterministic learning paths do not. The Compose stack is
loopback-only and is not a public deployment.

The local candidate is 75 VERIFIED / 1 IN_PROGRESS / 24 BLOCKED across its
100-item evidence ledger, so its overall decision remains NO_GO. Missing inputs
include official competition rules, a real learner pilot, CSS and pedagogy
expert review, legal guidance, real-device and second-network rehearsal, a
clean-checkout reproduction of the final candidate, and an independent final
review. A new 30-minute soak was waived, so long-duration stability is not
claimed. Container scans retain documented upstream findings; the project
does not claim zero vulnerabilities.

## What we would improve next

First, run a preregistered learner pilot with completion, transfer, and delayed
retention measures, preserving failures and withdrawals. Second, add expert
rubric review and human accessibility testing. Third, finish interface
localization and a learner-facing language switch. Fourth, publish a hardened
deployment, repeat performance and recovery on a second machine and network,
and bind evidence to signed Git and CI provenance. Finally, persist the exact
grounding receipt for every Realtime causal statement so historical replay can
audit each explanation end to end.

## Repository review guide

- apps/web/src/features/canvas/CanvasWorkspace.tsx — the visual canvas
  orchestration and teaching-block workflow.
- apps/web/src/features/canvas/EnglishDemoPresentation.tsx — the
  query-scoped English recording presentation and visible-English guard.
- apps/web/src/app/api/realtime/session/route.ts and route.test.ts — optional
  unbound Tutor startup and strict validation for explicitly bound learning
  sessions.
- packages/runtime-static-html/src/runtime.ts — sandboxed static-page runtime
  lifecycle; sandbox-document.ts and inspection-bridge.ts show script removal
  and versioned inspection messages.
- apps/web/src/features/lesson/box-model-lesson.ts and scenario-lesson.ts —
  deterministic lesson reducers and the Predict–Observe–Explain–Transfer
  sequence.
- apps/web/src/features/lesson/personalized-course.ts — derives a minimal course
  from imported source facts and a frozen transfer task.
- apps/web/src/features/tutor/teaching-facts.ts and tutor-tool-executor.ts —
  bounded fact reads and grounded tutor tool execution.
- apps/web/src/features/learning/LearningProofReplay.tsx and
  server/learning-proof-store.ts — replay UI and authoritative event/snapshot
  persistence.
- packages/contracts/src/learning-proof.ts — versioned Learning Proof event
  contracts.
- tests/e2e/source-editor.spec.ts, personalized-course.spec.ts,
  learning-proof.spec.ts, p8-failure-matrix.spec.ts, and p8-security.spec.ts —
  the main browser workflows, recovery, and security boundaries.
- docs/RESULTS_AND_LIMITATIONS_2026-08-02.md — detailed measured results and
  explicit non-claims.

Run the project and test suite using the exact commands in README.md. Realtime
Live tests are external-service dependent and skipped without the required
local authenticated capability. No user results are mocked; deterministic
fallback tutoring and synthetic microphone test tracks are explicitly labeled.
