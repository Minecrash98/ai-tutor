# English audio script — Demo v3

The final mix uses three roles:

- Narrator — fast, warm local English voice used for launch framing.
- Student — lighter local English voice speaking all ten scripted prompts.
- AI Tutor — unedited transcript content from the authenticated live Tutor
  session.

The browser output stayed muted during capture. The Tutor track was recorded
directly from the remote WebRTC stream.

## 00:00–00:20 — Launch opening

Narrator:

Most CSS lessons explain variables. AI Tutor turns them into a live experiment.

A student imports real HTML and CSS. The page, source, and every saved version
stay together.

One root token drives buttons, borders, labels, highlights, and shadows.

Now the student asks the Tutor to build the next useful tool.

## 00:21–00:59 — Turn 1: create the learning tool

Student:

I want to change the page color. Inspect the source and make a quick control
for the global brand token. I will choose the color.

AI Tutor:

I want to change the page color, so please make a quick control for the global
brand token after you inspect the source. Checking that. Done, a color control
for the root brand token is ready, so pick whichever color you want there.

## 01:00–01:04 — Control transition

Narrator:

The Tutor verified the source and built a real color control. The student keeps
the choice.

## 01:04–01:25 — Turn 2: first prediction

Student:

Before I choose, what changes first?

AI Tutor:

Before I choose, predict the first visible change. The elements using the brand
token, like buttons or other primary accents, should shift color first.

## 01:25–01:51 — Turn 3: define the comparison

Student:

I predict every accent changes while layout stays fixed. What should I compare?

AI Tutor:

My prediction is every accent changes while layout stays fixed. What should I
compare? Compare buttons, links, icons, borders, and highlights before and
after, and check that positions, sizes, spacing, and wrapping don’t move.

## 01:51–01:56 — Visible evidence

Narrator:

One click moves the same color through every consumer while layout stays fixed.

## 01:56–02:19 — Turn 4: synchronized change

Student:

Mint is applied. What does the synchronized change demonstrate?

AI Tutor:

Mint is applied. Explain what that synchronized change demonstrates. It shows
one root variable synchronizing color across multiple elements without changing
layout.

## 02:19–02:49 — Turn 5: shared consumers

Student:

Why did one choice update several components?

AI Tutor:

It suggests one shared token coordinates the accents, while layout is
independent of that color. For page proof, which changed accent did you notice?
Because components resolve var brand from root, changing that one value updates
every consumer.

## 02:49–03:19 — Turn 6: stable layout

Student:

Why did the layout stay fixed?

AI Tutor:

The edit changed only a color token; layout comes from widths, gaps, and
positions which were untouched.

## 03:19–03:38 — Turn 7: document scope

Student:

What does root contribute here?

AI Tutor:

What does root contribute here? Root defines brand once at document scope, so
descendants reuse it for consistent theming.

## 03:39–04:02 — Turn 8: local override

Student:

What happens if one card redeclares brand?

AI Tutor:

What happens if one card redeclares brand? That card and its descendants use
the new brand value, while the rest keeps the root value, which is standard
inheritance and local override.

## 04:02–04:23 — Turn 9: semantic naming

Student:

Why is brand a durable token name?

AI Tutor:

Why is brand a durable token name? It names a stable design role, not a
specific color, so themes can change values without rewriting components.

## 04:23–04:45 — Turn 10: transfer

Student:

Give me a one-sentence transfer challenge using a local override.

AI Tutor:

Give me a one-sentence transfer challenge using a local override. Override
brand on one card so only its accents change while the page stays mint.

## 04:45–05:00 — Compare and close

Narrator:

Ten exchanges end in a saved revision and a side-by-side comparison.

That is AI Tutor: predict, change, observe, explain, compare, and transfer. The
AI creates the experiment. The learner owns the decision.
