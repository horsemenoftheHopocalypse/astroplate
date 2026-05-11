# Event Rotator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the homepage `CountDown` component with a Swiper-based `EventRotator` partial that shows competition events, their 5 key milestone dates, and a live countdown to the next upcoming milestone; the same component also appears on the competitions page.

**Architecture:** A single self-fetching `EventRotator.astro` partial reads from two content collections (`events` for per-event files, `eventsRotatorSection` for section header config). A `compact` boolean prop controls Swiper breakpoints — 1 slide on the homepage, up to 3 on the competitions page. All countdown and milestone-state logic runs in client-side JS using `data-` attributes to avoid element ID conflicts between cards.

**Tech Stack:** Astro 5, Zod content collections, Swiper 11, TailwindCSS, TypeScript

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `src/content/events/bluebonnet-brewoff-2026.md` | Example event with 5 milestone dates |
| Create | `src/content/sections/events-rotator.md` | Section enable/title/description |
| Create | `src/layouts/partials/EventRotator.astro` | Component: markup + countdown JS + Swiper |
| Modify | `.gitignore` | Add `.superpowers/` |
| Modify | `src/content.config.ts` | Two new collection definitions + exports |
| Modify | `src/pages/index.astro` | Remove CountDown, add EventRotator compact |
| Modify | `src/pages/competitions.astro` | Add EventRotator below PageHeader |

---

## Task 1: Add `.superpowers/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

- [ ] **Step 1: Add entry**

Append to `.gitignore`:
```
# brainstorming session files
.superpowers/
```

- [ ] **Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .superpowers/ brainstorming artifacts"
```

---

## Task 2: Add two new collections to `content.config.ts`

**Files:**
- Modify: `src/content.config.ts`

- [ ] **Step 1: Add collection definitions**

After the `brewerSpotlightSectionCollection` definition (around line 173), insert:

```ts
// Events collection schema — one file per event
const eventsCollection = defineCollection({
  loader: glob({ pattern: "**/*.{md,mdx}", base: "src/content/events" }),
  schema: z.object({
    title: z.string(),
    image: z.string(),
    link: z.string().optional(),
    milestones: z.object({
      entries_open:   z.date(),
      entries_close:  z.date(),
      shipping_open:  z.date(),
      shipping_close: z.date(),
      awards:         z.date(),
    }),
    draft: z.boolean().optional(),
  }),
});

// Events Rotator section header schema
const eventsRotatorSectionCollection = defineCollection({
  loader: glob({
    pattern: "events-rotator.{md,mdx}",
    base: "src/content/sections",
  }),
  schema: z.object({
    enable: z.boolean(),
    title: z.string(),
    description: z.string(),
  }),
});
```

- [ ] **Step 2: Add to exports**

In the `export const collections = { ... }` block, add after `brewerSpotlightSection`:

```ts
  events: eventsCollection,
  eventsRotatorSection: eventsRotatorSectionCollection,
```

- [ ] **Step 3: Verify the file compiles**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate && npm run check 2>&1 | head -40
```

Expected: no TypeScript errors related to the new collections. (Other pre-existing errors are acceptable.)

- [ ] **Step 4: Commit**

```bash
git add src/content.config.ts
git commit -m "feat: add events and eventsRotatorSection content collections"
```

---

## Task 3: Create content data files

**Files:**
- Create: `src/content/sections/events-rotator.md`
- Create: `src/content/events/bluebonnet-brewoff-2026.md`

- [ ] **Step 1: Create the section header file**

Create `src/content/sections/events-rotator.md`:

```markdown
---
enable: true
title: "Upcoming Competitions"
description: "Track key dates for competitions we participate in."
---
```

- [ ] **Step 2: Create the example event file**

Create `src/content/events/bluebonnet-brewoff-2026.md`:

```markdown
---
title: "Bluebonnet Brewoff 2026"
image: "/images/2026 BBO Logo.jpeg"
link: "https://www.bcoem.bluebonnetbrewoff.org/"
milestones:
  entries_open:   2026-01-15T00:00:00-06:00
  entries_close:  2026-02-01T00:00:00-06:00
  shipping_open:  2026-02-10T00:00:00-06:00
  shipping_close: 2026-02-24T00:00:00-06:00
  awards:         2026-03-08T12:00:00-06:00
draft: false
---
```

- [ ] **Step 3: Verify Astro can parse the new collection**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate && npm run check 2>&1 | grep -i "events\|error" | head -20
```

Expected: no errors about the `events` or `eventsRotatorSection` collections.

- [ ] **Step 4: Commit**

```bash
git add src/content/sections/events-rotator.md src/content/events/bluebonnet-brewoff-2026.md
git commit -m "feat: add events-rotator section config and BBO 2026 example event"
```

---

## Task 4: Create `EventRotator.astro`

**Files:**
- Create: `src/layouts/partials/EventRotator.astro`

- [ ] **Step 1: Create the component**

Create `src/layouts/partials/EventRotator.astro` with the following content:

```astro
---
import ImageMod from "@/components/ImageMod.astro";
import { getCollection } from "astro:content";
import { getListPage } from "@/lib/contentParser.astro";
import { markdownify } from "@/lib/utils/textConverter";

interface Props {
  compact?: boolean;
}

const { compact = false } = Astro.props;

const eventsRotatorSection = await getListPage("eventsRotatorSection", "events-rotator");
const allEvents = await getCollection("events", ({ data }) => !data.draft);
const events = allEvents.sort(
  (a, b) => a.data.milestones.awards.getTime() - b.data.milestones.awards.getTime(),
);

const nonAwardKeys = ["entries_open", "entries_close", "shipping_open", "shipping_close"] as const;
type NonAwardKey = typeof nonAwardKeys[number];

const milestoneLabels: Record<NonAwardKey | "awards", string> = {
  entries_open:   "Entries Open",
  entries_close:  "Entries Close",
  shipping_open:  "Shipping Opens",
  shipping_close: "Shipping Closes",
  awards:         "Awards",
};

// data-attribute names (underscore → hyphen)
const milestoneAttr: Record<NonAwardKey | "awards", string> = {
  entries_open:   "entries-open",
  entries_close:  "entries-close",
  shipping_open:  "shipping-open",
  shipping_close: "shipping-close",
  awards:         "awards",
};
---

{
  eventsRotatorSection.data.enable && (
    <section class="section">
      <div class="container">
        <div class="row">
          <div class="mx-auto mb-12 text-center md:col-10 lg:col-8 xl:col-6">
            <h2 set:html={markdownify(eventsRotatorSection.data.title)} class="mb-4" />
            <p set:html={markdownify(eventsRotatorSection.data.description)} />
          </div>
          <div class="col-12">
            <div
              class="swiper event-rotator-slider"
              data-compact={compact ? "true" : "false"}
            >
              <div class="swiper-wrapper">
                {events.map((event) => {
                  const ms = event.data.milestones;
                  return (
                    <div class="swiper-slide">
                      <div
                        class="event-card rounded-lg bg-light dark:bg-darkmode-light overflow-hidden"
                        data-event-card
                        data-entries-open={ms.entries_open.getTime()}
                        data-entries-close={ms.entries_close.getTime()}
                        data-shipping-open={ms.shipping_open.getTime()}
                        data-shipping-close={ms.shipping_close.getTime()}
                        data-awards={ms.awards.getTime()}
                      >
                        <ImageMod
                          src={event.data.image}
                          alt={event.data.title}
                          width={576}
                          height={300}
                          class="w-full object-cover"
                          format="webp"
                          loading="eager"
                        />
                        <div class="px-6 py-4">
                          <div class="font-bold text-xl mb-3 text-text-dark dark:text-white">
                            {event.data.title}
                          </div>

                          <div class="completed-badge hidden mb-3">
                            <span class="inline-block bg-gray-500 text-white text-xs font-semibold px-3 py-1 rounded-full uppercase tracking-wide">
                              Completed
                            </span>
                          </div>

                          <div class="countdown-section">
                            <div class="text-sm font-semibold text-amber-500 mb-2">
                              ⏱ Next: <span data-milestone-label>—</span>
                            </div>
                            <div class="flex justify-center gap-3 mb-4">
                              <div class="text-center bg-body dark:bg-darkmode-body rounded-lg px-3 py-2 min-w-[52px]">
                                <div class="text-2xl font-bold text-text-dark dark:text-white" data-days>--</div>
                                <div class="text-xs text-text-light dark:text-darkmode-text-light uppercase">Days</div>
                              </div>
                              <div class="text-center bg-body dark:bg-darkmode-body rounded-lg px-3 py-2 min-w-[52px]">
                                <div class="text-2xl font-bold text-text-dark dark:text-white" data-hours>--</div>
                                <div class="text-xs text-text-light dark:text-darkmode-text-light uppercase">Hrs</div>
                              </div>
                              <div class="text-center bg-body dark:bg-darkmode-body rounded-lg px-3 py-2 min-w-[52px]">
                                <div class="text-2xl font-bold text-text-dark dark:text-white" data-minutes>--</div>
                                <div class="text-xs text-text-light dark:text-darkmode-text-light uppercase">Min</div>
                              </div>
                              <div class="text-center bg-body dark:bg-darkmode-body rounded-lg px-3 py-2 min-w-[52px]">
                                <div class="text-2xl font-bold text-text-dark dark:text-white" data-seconds>--</div>
                                <div class="text-xs text-text-light dark:text-darkmode-text-light uppercase">Sec</div>
                              </div>
                            </div>
                          </div>

                          <div class="grid grid-cols-2 gap-2">
                            {nonAwardKeys.map((key) => (
                              <div
                                class="milestone-tile rounded px-3 py-2 border-l-4 border-border dark:border-darkmode-border bg-body dark:bg-darkmode-body"
                                data-milestone={milestoneAttr[key]}
                                data-date={ms[key].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                              >
                                <div class="text-xs text-text-light dark:text-darkmode-text-light uppercase">
                                  {milestoneLabels[key]}
                                </div>
                                <div class="text-sm font-semibold text-text dark:text-darkmode-text milestone-date">
                                  {ms[key].toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                                </div>
                              </div>
                            ))}
                            <div
                              class="milestone-tile col-span-2 rounded px-3 py-2 border-l-4 border-border dark:border-darkmode-border bg-body dark:bg-darkmode-body"
                              data-milestone="awards"
                              data-date={ms.awards.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                            >
                              <div class="text-xs text-text-light dark:text-darkmode-text-light uppercase">
                                Awards
                              </div>
                              <div class="text-sm font-semibold text-text dark:text-darkmode-text milestone-date">
                                {ms.awards.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
                              </div>
                            </div>
                          </div>

                          {event.data.link && (
                            <div class="mt-4 text-center">
                              <a
                                href={event.data.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                class="text-primary hover:underline text-sm font-semibold"
                              >
                                Visit Competition Site →
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {!compact && <div class="swiper-button-prev" />}
              {!compact && <div class="swiper-button-next" />}

              <div class="event-rotator-slider-pagination mt-9 flex items-center justify-center text-center" />
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

<script>
  import { Swiper } from "swiper";
  import "swiper/css";
  import "swiper/css/pagination";
  import "swiper/css/navigation";
  import { Autoplay, Pagination, Navigation } from "swiper/modules";

  const MILESTONES = [
    { key: "entries-open",   label: "Entries Open" },
    { key: "entries-close",  label: "Entries Close" },
    { key: "shipping-open",  label: "Shipping Opens" },
    { key: "shipping-close", label: "Shipping Closes" },
    { key: "awards",         label: "Awards" },
  ];

  function initCard(card: HTMLElement) {
    const now = Date.now();
    const timestamps: Record<string, number> = {
      "entries-open":   Number(card.dataset.entriesOpen),
      "entries-close":  Number(card.dataset.entriesClose),
      "shipping-open":  Number(card.dataset.shippingOpen),
      "shipping-close": Number(card.dataset.shippingClose),
      "awards":         Number(card.dataset.awards),
    };

    const active = MILESTONES.find(({ key }) => timestamps[key] > now);

    // Apply visual state to each tile
    MILESTONES.forEach(({ key }) => {
      const tile = card.querySelector<HTMLElement>(`[data-milestone="${key}"]`);
      if (!tile) return;
      const dateEl = tile.querySelector<HTMLElement>(".milestone-date");
      const original = tile.dataset.date ?? "";

      tile.classList.remove("border-green-500", "border-amber-500", "opacity-60");

      if (timestamps[key] <= now) {
        tile.classList.add("border-green-500", "opacity-60");
        if (dateEl) dateEl.textContent = "✓ " + original;
      } else if (active && key === active.key) {
        tile.classList.add("border-amber-500");
        if (dateEl) dateEl.textContent = original;
      } else {
        if (dateEl) dateEl.textContent = original;
      }
    });

    if (!active) {
      card.querySelector(".countdown-section")?.classList.add("hidden");
      card.querySelector(".completed-badge")?.classList.remove("hidden");
      return;
    }

    const labelEl = card.querySelector<HTMLElement>("[data-milestone-label]");
    if (labelEl) labelEl.textContent = active.label;

    const daysEl    = card.querySelector<HTMLElement>("[data-days]")!;
    const hoursEl   = card.querySelector<HTMLElement>("[data-hours]")!;
    const minutesEl = card.querySelector<HTMLElement>("[data-minutes]")!;
    const secondsEl = card.querySelector<HTMLElement>("[data-seconds]")!;

    const target = timestamps[active.key];
    let lastUpdate = Date.now();

    function animate() {
      const t = Date.now();
      if (t - lastUpdate >= 1000) {
        lastUpdate = t;
        const dist = target - t;
        if (dist <= 0) {
          initCard(card);
          return;
        }
        daysEl.textContent    = String(Math.floor(dist / 86400000));
        hoursEl.textContent   = String(Math.floor((dist % 86400000) / 3600000)).padStart(2, "0");
        minutesEl.textContent = String(Math.floor((dist % 3600000) / 60000)).padStart(2, "0");
        secondsEl.textContent = String(Math.floor((dist % 60000) / 1000)).padStart(2, "0");
      }
      requestAnimationFrame(animate);
    }
    requestAnimationFrame(animate);
  }

  document.addEventListener("astro:page-load", () => {
    const slider = document.querySelector<HTMLElement>(".event-rotator-slider");
    if (!slider) return;

    const isCompact  = slider.dataset.compact === "true";
    const eventCount = document.querySelectorAll("[data-event-card]").length;

    document.querySelectorAll<HTMLElement>("[data-event-card]").forEach(initCard);

    new Swiper(".event-rotator-slider", {
      modules: [Pagination, Autoplay, Navigation],
      spaceBetween: 24,
      loop: eventCount > 1,
      autoplay: eventCount > 1
        ? { delay: isCompact ? 4000 : 5000, disableOnInteraction: false }
        : false,
      navigation: isCompact
        ? false
        : { nextEl: ".swiper-button-next", prevEl: ".swiper-button-prev" },
      pagination: {
        el: ".event-rotator-slider-pagination",
        type: "bullets",
        clickable: true,
      },
      breakpoints: isCompact ? {} : {
        768: { slidesPerView: 2 },
        992: { slidesPerView: 3 },
      },
    });
  });
</script>

<style is:global>
  .event-rotator-slider-pagination .swiper-pagination-bullet {
    width: 14px !important;
    height: 14px !important;
    background-color: #666 !important;
    opacity: 1 !important;
    border: 2px solid #333 !important;
    margin: 0 6px !important;
  }

  .event-rotator-slider-pagination .swiper-pagination-bullet-active {
    background-color: var(--color-primary) !important;
    border-color: var(--color-primary) !important;
  }

  .dark .event-rotator-slider-pagination .swiper-pagination-bullet {
    background-color: #999 !important;
    border: 2px solid #fff !important;
  }

  .dark .event-rotator-slider-pagination .swiper-pagination-bullet-active {
    background-color: var(--color-darkmode-primary) !important;
    border-color: var(--color-darkmode-primary) !important;
  }
</style>
```

- [ ] **Step 2: Run type check**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate && npm run check 2>&1 | grep -E "error|EventRotator" | head -30
```

Expected: no errors in `EventRotator.astro`. Fix any TypeScript complaints before proceeding.

- [ ] **Step 3: Commit**

```bash
git add src/layouts/partials/EventRotator.astro
git commit -m "feat: add EventRotator partial with Swiper + milestone countdown"
```

---

## Task 5: Wire `EventRotator` into the homepage

**Files:**
- Modify: `src/pages/index.astro`

- [ ] **Step 1: Replace CountDown import with EventRotator**

In `src/pages/index.astro`, line 11, replace:
```ts
import CountDown from "@/components/CountDown.astro";
```
with:
```ts
import EventRotator from "@/partials/EventRotator.astro";
```

- [ ] **Step 2: Remove `countdown` from the destructure**

Line 22 currently reads:
```ts
const { banner, countdown } = homepage.data;
```
Change to:
```ts
const { banner } = homepage.data;
```

- [ ] **Step 3: Replace the CountDown section block**

Remove this block (lines 73–84):
```astro
<section class="section pt-0">
  <div class="container">
    <div class="row justify-center">
      <CountDown
        image={countdown.image}
        title={countdown.title}
        date={countdown.date}
        link={countdown.link}
      />
    </div>
  </div>
</section>
```

Replace with:
```astro
<EventRotator compact={true} />
```

Place it in the same position in the page (after `<ContactUs />` section, before `</Base>`).

- [ ] **Step 4: Verify with type check**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate && npm run check 2>&1 | grep -E "error|index" | head -20
```

Expected: no errors about `CountDown`, `countdown`, or `EventRotator` in `index.astro`.

- [ ] **Step 5: Start dev server and verify homepage**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate && npm run dev:astro
```

Open `http://localhost:4321` and confirm:
- The EventRotator section appears where the CountDown used to be
- The card shows the BBO 2026 event with image, countdown, and 5 milestone tiles
- Swiper pagination bullets are visible
- Countdown ticks every second

- [ ] **Step 6: Commit**

```bash
git add src/pages/index.astro
git commit -m "feat: replace CountDown with EventRotator on homepage"
```

---

## Task 6: Wire `EventRotator` into the competitions page

**Files:**
- Modify: `src/pages/competitions.astro`

- [ ] **Step 1: Add the EventRotator import**

At the top of `src/pages/competitions.astro`, after the existing imports, add:
```ts
import EventRotator from "@/partials/EventRotator.astro";
```

- [ ] **Step 2: Insert EventRotator between PageHeader and the first section**

After `<PageHeader title="Competitions" />` and before `<section class="section pt-0">`, insert:
```astro
<EventRotator />
```

- [ ] **Step 3: Verify with type check**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate && npm run check 2>&1 | grep -E "error|competitions" | head -20
```

Expected: no errors in `competitions.astro`.

- [ ] **Step 4: Verify in dev server**

With the dev server running, open `http://localhost:4321/competitions` and confirm:
- The EventRotator appears below the page header and above the existing club competition card
- At viewport ≥992px, up to 3 slides are shown side-by-side (currently only 1 event exists, so 1 card appears)
- Prev/next navigation arrows are rendered (they will be non-functional with a single event — that's expected)

- [ ] **Step 5: Commit**

```bash
git add src/pages/competitions.astro
git commit -m "feat: add EventRotator to competitions page"
```

---

## Task 7: Production build verification

- [ ] **Step 1: Run full build**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate && npm run build 2>&1 | tail -30
```

Expected: build completes without errors. The output should show pages for `/` and `/competitions` generated successfully.

- [ ] **Step 2: Preview the build**

```bash
cd /Users/barryforrest/Projects/Horsemen/astro/astroplate && npm run preview
```

Open `http://localhost:4321` and `http://localhost:4321/competitions`. Verify both pages load, the rotator renders, and the countdown ticks.

- [ ] **Step 3: Commit if any last fixes were needed**

If the build step required any fixes, commit them:
```bash
git add -p
git commit -m "fix: resolve build issues in EventRotator"
```

---

## Adding Future Events

To add a new competition event, create a new file in `src/content/events/`:

```markdown
---
title: "Spirit of '76 2026"
image: "/images/spirit-of-76-logo.png"
link: "https://example.com"
milestones:
  entries_open:   2026-05-01T00:00:00-05:00
  entries_close:  2026-06-01T00:00:00-05:00
  shipping_open:  2026-06-10T00:00:00-05:00
  shipping_close: 2026-06-20T00:00:00-05:00
  awards:         2026-07-04T12:00:00-05:00
draft: false
---
```

The rotator automatically picks it up and sorts by awards date.
