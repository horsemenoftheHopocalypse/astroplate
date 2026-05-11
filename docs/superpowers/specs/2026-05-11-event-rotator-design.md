# Event Rotator Design

**Date:** 2026-05-11
**Project:** Horsemen of the Hopocalypse — Astroplate site

## Summary

Replace the existing `CountDown` component on the homepage with a Swiper-based `EventRotator` that displays competition events with key milestone dates and a live countdown to the next upcoming milestone. The same component also serves as the main content section on the competitions page.

---

## Data Model

### New collection: `src/content/events/`

One `.md` file per event. Files sorted by `awards` date ascending when rendered.

**Schema (`content.config.ts`):**

```ts
const eventsCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/events" }),
  schema: z.object({
    title: z.string(),
    image: z.string(),
    link: z.string().optional(),
    milestones: z.object({
      entries_open:  z.date(),
      entries_close: z.date(),
      shipping:      z.date(),
      awards:        z.date(),
    }),
    draft: z.boolean().optional(),
  }),
});
```

**Example file (`src/content/events/bluebonnet-brewoff-2026.md`):**

```yaml
---
title: "Bluebonnet Brewoff 2026"
image: "/images/2026 BBO Logo.jpeg"
link: "https://www.bcoem.bluebonnetbrewoff.org/"
milestones:
  entries_open:  2026-01-15T00:00:00-06:00
  entries_close: 2026-02-01T00:00:00-06:00
  shipping:      2026-02-10T00:00:00-06:00
  awards:        2026-03-08T12:00:00-06:00
draft: false
---
```

### New section metadata: `src/content/sections/events-rotator.md`

```yaml
---
enable: true
title: "Upcoming Competitions"
description: "Track key dates for competitions we participate in."
---
```

**Schema:**

```ts
const eventsRotatorSectionCollection = defineCollection({
  loader: glob({ pattern: "events-rotator.{md,mdx}", base: "src/content/sections" }),
  schema: z.object({
    enable: z.boolean(),
    title: z.string(),
    description: z.string(),
  }),
});
```

Both collections exported in `content.config.ts` as `events` and `eventsRotatorSection`.

---

## Component Architecture

### New file: `src/layouts/partials/EventRotator.astro`

**Props:**

```ts
interface Props {
  compact?: boolean
}
```

- `compact={true}` — homepage: 1 slide visible at all breakpoints, autoplay delay 4000ms
- `compact={false}` (default) — competitions page: 1 → 2 (≥768px) → 3 (≥992px) slides, autoplay delay 5000ms, prev/next navigation arrows

**Data fetching (inside the component):**

```ts
import { getCollection } from "astro:content";
import { getListPage } from "@/lib/contentParser.astro";

const eventsRotatorSection = await getListPage("eventsRotatorSection", "events-rotator");
const allEvents = await getCollection("events", ({ data }) => !data.draft);
const events = allEvents.sort(
  (a, b) => a.data.milestones.awards.getTime() - b.data.milestones.awards.getTime()
);
```

**Card HTML structure (per slide):**

Each `swiper-slide` div carries milestone timestamps as `data-` attributes for the client-side countdown script:

```html
<div class="swiper-slide">
  <div
    class="event-card rounded-lg bg-light dark:bg-darkmode-light px-7 py-10"
    data-event-card
    data-entries-open="{ms}"
    data-entries-close="{ms}"
    data-shipping="{ms}"
    data-awards="{ms}"
  >
    <!-- image -->
    <!-- countdown display: data-days / data-hours / data-minutes / data-seconds -->
    <!-- active milestone label: data-milestone-label -->
    <!-- 4 milestone tiles (green/amber/dark border states set by JS) -->
    <!-- optional link -->
  </div>
</div>
```

Milestone tile visual states:

| State | Left border | Text style |
|---|---|---|
| Past | green (`#22c55e`) | muted, `✓` prefix |
| Active (next) | amber (`#f59e0b`) | full opacity |
| Future | dark (`#475569`) | muted |

**Past event handling:**

When all 4 milestones are in the past, JS sets `data-completed` on the card. CSS class `event-card--completed` reduces card opacity to 0.6 and shows a "Completed" badge over the image. No countdown digits shown — awards date displayed instead.

### Modified files

| File | Change |
|---|---|
| `src/content.config.ts` | Add `eventsCollection` and `eventsRotatorSectionCollection`; export as `events` and `eventsRotatorSection` |
| `src/pages/index.astro` | Remove `CountDown` import/usage; add `EventRotator` with `compact={true}` |
| `src/pages/competitions.astro` | Add `EventRotator` (no `compact` prop) as main section |

---

## Countdown Logic (Client-Side JS)

Runs in `<script>` block inside `EventRotator.astro`, triggered on `astro:page-load`.

**Algorithm per card:**

1. Read all 4 milestone timestamps from `data-` attributes.
2. Find the first milestone whose timestamp is greater than `Date.now()` — this is the active target.
3. Write the milestone name to `[data-milestone-label]` within the card.
4. Start a `requestAnimationFrame` loop that writes `days/hours/minutes/seconds` into `[data-days]`, `[data-hours]`, `[data-minutes]`, `[data-seconds]` **scoped to that card** via `card.querySelector(...)` — no global element IDs.
5. Apply border color classes to the 4 milestone tiles based on past/active/future state.
6. If no milestone is in the future, set `card.dataset.completed = "true"` and skip the timer.

All countdown loops for all cards start simultaneously on page load (all slides are in the DOM even when not visible in Swiper). This is intentional — it avoids flicker when the user navigates between slides.

---

## Swiper Configuration

```js
new Swiper(".event-rotator-slider", {
  modules: [Pagination, Autoplay, Navigation],
  spaceBetween: 24,
  loop: true,
  autoplay: {
    delay: compact ? 4000 : 5000,
    disableOnInteraction: false,
  },
  navigation: compact ? false : {
    nextEl: ".swiper-button-next",
    prevEl: ".swiper-button-prev",
  },
  pagination: {
    el: ".event-rotator-slider-pagination",
    type: "bullets",
    clickable: true,
  },
  breakpoints: compact ? {} : {
    768: { slidesPerView: 2 },
    992: { slidesPerView: 3 },
  },
});
```

The `compact` value is passed from Astro to the script block via `define:vars`.

**Edge case — single event:** Swiper's `loop: true` requires at least `slidesPerView * 2` slides to function. When `events.length <= 1`, pass `loop: false` and omit `autoplay`. The event count is also passed via `define:vars` so the JS can conditionally set these options.

---

## File Checklist

- [ ] `src/content/events/` directory + at least one example event file
- [ ] `src/content/sections/events-rotator.md`
- [ ] `src/content.config.ts` — two new collections + exports
- [ ] `src/layouts/partials/EventRotator.astro`
- [ ] `src/pages/index.astro` — swap CountDown → EventRotator
- [ ] `src/pages/competitions.astro` — add EventRotator section
- [ ] `.gitignore` — add `.superpowers/`
