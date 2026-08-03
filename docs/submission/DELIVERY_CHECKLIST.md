# Submission delivery checklist

## Ready locally

### Submission copy

- Submission title: AI Tutor Canvas — Change Once, Understand Everywhere
- Project name: AI Tutor Canvas
- Short summary: docs/submission/LAUNCHPAD_SUBMISSION_FIELDS.md
- Full write-up: docs/submission/FULL_WRITEUP.md
- Verified write-up length: 874 words
- Repository review guide: docs/submission/REPOSITORY_REVIEW_GUIDE.md
- YouTube title, description, and chapters:
  docs/submission/YOUTUBE_DEMO_PACKAGE.md

### Final five-minute video

- File:
  output/playwright/css-global-color-variables-youtube-demo-en-v3-2026-08-03.mp4
- SHA-256:
  ca3cfbb4a9d0892ebb4b67559c5d843ddcc90bcb910080d4156367cc8c672c43
- Size: 19,327,115 bytes
- Duration: 300.000 seconds
- Frames: 7,500
- Video: H.264 High, 1280×720, 25 fps, yuv420p
- Audio: AAC-LC, 48 kHz, mono
- Integrated loudness: -17.2 LUFS
- True peak: -1.4 dBFS

Generated visual QA artifacts:

- Contact sheet:
  output/playwright/css-v3-final-contact-sheet.jpg
  (SHA-256 f983cc589ef1084139bb5d1a24b496c33c81ec0f364c28abf4c66525a7409eb6)
- Tutor/control frame:
  output/playwright/css-v3-control-interaction-frame.jpg
  (SHA-256 ee1819035e4b682e81a5eadb731ee388215ecac344c743163666ebb5424ecd01)
- Mint evidence frame:
  output/playwright/css-v3-mint-evidence-frame.jpg
  (SHA-256 cdc3b5c9a9a36aa9c7f8c42a2ede185bdaf3ceda083a4f4538c531cad95932f6)
- Comparison frame:
  output/playwright/css-v3-comparison-frame.jpg
  (SHA-256 9647d70063b9da941b72aab0eea8ac91fc8192ba0cfa36b1825962519dd14d22)
- Ending frame:
  output/playwright/css-v3-final-ending-frame.jpg
  (SHA-256 ded9193a72d23fb9cdd368def14168ee279c4c652666ed9be462880f7fd3b737)

### Live Tutor interaction evidence

- Evidence:
  output/playwright/ai-tutor-demo-evidence-raw-en-v3-2026-08-03.json
- Evidence SHA-256:
  5f3861ce94326b635d6aae14618713a2f642777a9817c66b9f3b95d7a34023c0
- Scripted student turns completed: 10
- Live Tutor turns completed: 10
- Tutor-created control binding: :root --brand
- Initial value: #6750a4
- Student-selected final value: #0f9f8f
- Tutor control tool observed: yes
- Tutor voice source: captured remote WebRTC audio track
- Raw Tutor audio:
  output/playwright/ai-tutor-live-voice-raw-en-v3-2026-08-03.webm
- Raw Tutor audio SHA-256:
  0de7523081343cffd40d077e4ddc348aef81af02fc60e1d5b6708e03e1e5694c
- Capture browser: fresh isolated profile with muted local playback
- Microphone input: one generated silent fake-media track
- Physical microphone used: no
- English presentation guard: zero visible CJK findings at all recorded
  checkpoints, including all ten Tutor turns and comparison

### Narrator, student voice, and captions

- Local voice master:
  output/playwright/css-global-color-variables-local-voices-raw-en-v3-2026-08-03.wav
- Local voice SHA-256:
  61842f711e4c140c281f32dd78696e680897902fa2b8a3b12155c33aecf81cf4
- Local voice segments: 8 narrator + 10 student
- Voice model: Piper en_US-lessac-high, generated locally
- Exact audio script: docs/submission/NARRATION_SCRIPT.md
- SubRip captions:
  docs/submission/captions/ai-tutor-css-variables-en-v3.srt
- SubRip SHA-256:
  9c442b237c7c5549a8ff541c587eac64c4edd772b0cedcbf2ce2dc5a18d329a1
- WebVTT captions:
  docs/submission/captions/ai-tutor-css-variables-en-v3.vtt
- WebVTT SHA-256:
  347342be9b246fcc000b86c2416f7446f7656c0ea6fb96f632e5ea20fac063b1
- Caption cues: 66
- Final caption end: 00:04:59.140
- Caption language: English

### Cover image

- File: docs/submission/assets/ai-tutor-cover.png
- SHA-256:
  d060b3f8bf5c511d5a50d755ed1d30910aee9afc9391294bffcabc8c6d5caba2
- Size: 417,238 bytes
- Dimensions: 1600×900
- Format: PNG
- Language: English

## Current-source validation

- pnpm lint — passed
- pnpm typecheck — passed across six workspace packages
- pnpm test — 246 passed, 10 account-dependent skipped
- pnpm build — optimized Next.js production build passed
- pnpm test:e2e — 67 Chromium tests passed, 18 Live capability tests skipped
- Focused live demo smoke — Tutor created the :root --brand control and
  returned a non-empty remote audio track
- Final recording — 10 scripted student turns, 10 live Tutor responses, Mint
  save, comparison, English guard, and media-safety assertions passed

## External publication status

- GitHub: https://github.com/Minecrash98/ai-tutor
- YouTube: PENDING_YOUTUBE_URL

The remaining submission action is the external YouTube upload. Publish as
Public or Unlisted, enable embedding, attach the v3 captions and cover image,
verify playback while signed out, then replace PENDING_YOUTUBE_URL in:

- docs/submission/LAUNCHPAD_SUBMISSION_FIELDS.md
- docs/submission/DELIVERY_MANIFEST.json
