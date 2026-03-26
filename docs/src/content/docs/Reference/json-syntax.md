---
title: Getting Started With JSON
description: The basics about JSON and using it on this site.
---

JSON is a **simple data format** that Astro can read from files or APIs to build pages.

## 1. What JSON looks like

JSON is made of:

- **Objects** – curly braces `{}` with key–value pairs
  - Example:

```json
    {
      "name": "Sample Event",
      "date": "2026-04-10",
      "location": "Dallas, TX"
    }
```

- **Arrays (lists)** – square brackets `[]` with items separated by commas
  - Example:
```json
  [
    "Dallas",
    "Houston",
    "Austin"
  ]
```

Values can be:

- Text in quotes: `"Barry Forrest"`
- Numbers: `42`
- True/false: `true`, `false`
- Empty value: `null`
- Another object `{ ... }` or array `[ ... ]`

## 2. Simple content example

A list of pages or items often looks like:

```json
[
  {
    "title": "Competition 2026",
    "slug": "competition-2026",
    "date": "2026-05-15",
    "city": "Dallas"
  },
  {
    "title": "Competition 2025",
    "slug": "competition-2025",
    "date": "2025-05-10",
    "city": "Austin"
  }
]
```

Think of this as a spreadsheet:

- Each `{ ... }` is a row.
- Each `"title": "Competition 2026"` is a column name (`title`) with a value (`Competition 2026`).

Astro can loop over this list to render cards, tables, or pages. [cloudcannon](https://cloudcannon.com/tutorials/astro-beginners-tutorial-series/astro-json-imports/)

## 3. How Astro uses JSON (high level)

You don’t need to write code, but it helps to know **what your edits affect**:

- **JSON files in the project** (for example `src/data/events.json`) can be imported into Astro components and templates. [cloudcannon](https://cloudcannon.com/tutorials/astro-beginners-tutorial-series/astro-json-imports/)
- Astro reads the JSON and uses it to:
  - Build lists (cards, tables, navigation).
  - Fill in page details (titles, dates, links).
- When you edit JSON content correctly, the site updates on the next build/deploy.

Example pattern the developer handles:

```ts
import events from "../data/events.json";
// Astro then loops over `events` to show each one.
```

You only need to keep the **shape** of the data the same (same keys, same kinds of values). [dev.solita](https://dev.solita.fi/2024/12/02/building-static-websites-with-astro.html)

## 4. Editing rules (do’s and don’ts)

Do:

- Keep keys exactly the same: `"title"`, `"slug"`, `"date"`, etc.
- Keep quotes around text values: `"Dallas"` not `Dallas`.
- Keep commas between items, but **not** after the last one.

Don’t:

- Change `{` or `}` or `[` or `]`.
- Add comments like `// note` inside JSON (JSON does not allow comments).
- Leave a trailing comma after the last item in a list or object.

If something breaks, it’s almost always:

- A missing or extra comma.
- A missing quote.
- A `{` or `}` accidentally deleted.

## 5. Safe "copy & edit" workflow

1. **Copy an existing item** (one full `{ ... }` block, including commas where needed).
2. Paste it right below and change only the values on the right side of `:`.
3. Make sure:
   - Each item except the last ends with a comma.
   - The last item in the list has **no** comma after the closing `}`.
