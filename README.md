# 🍽️ Weekly Meal Planner

A simple, personal meal-planning app that runs entirely in your browser — no installs, no accounts, no server.

## How to use it

**Just open `index.html` in any browser.** That's it.

### Where your data lives

- **Recipes** are permanently stored as [`recipes.json`](recipes.json) in this GitHub repository — every save is a versioned commit, so nothing is ever lost. Set it up once via **⚙️ (sync settings)** on the My Recipes tab: create a fine-grained GitHub token (github.com → Settings → Developer settings → Fine-grained tokens; scope it to only this repo with **Contents: Read and write**) and paste it in. Then **☁️ Save to GitHub** commits your recipes, and the app pulls the latest on startup. A status pill shows whether you have unsaved changes. Use **Load from GitHub** to pull recipes saved from another device.
- **The weekly plan and grocery check-offs** stay in your browser — they're throwaway weekly state, regenerated each week.
- The browser also keeps a working copy of recipes so the app works offline; unsaved local changes are never overwritten by a startup pull.

## What it does

### 📖 My Recipes — your recipe repository
Store every recipe with its ingredients, quantities, units, how many servings it makes, and which meals it's good for (lunch, dinner, or either). Search by name, tag, or ingredient. The app comes with a few starter recipes you can edit or delete.

### 🗓️ Weekly Plan — lunch & dinner for 2, automatically
Click **Generate Week** and the app fills a lunch and a dinner for every day Monday–Sunday, using only recipes marked as fitting that slot. Every meal is scaled to **2 servings** — each slot shows exactly what fraction or multiple of the recipe to make (e.g. "make ½× the recipe" for a 4-serving dish). Like a meal? Click **Keep** to lock it before re-generating. Want something else? **Swap** replaces just that one slot.

### 🛒 Grocery List — built for you
The grocery list is generated from the week's plan: quantities are scaled for 2 people, the same ingredient across multiple recipes is combined into one line, and everything is grouped by store section (Produce, Meat & Seafood, Dairy, Pantry…). Check items off as you shop, copy the list to your phone, or print it.

### ✨ Discover — 2 new recipes every week
Each week the app suggests **two recipes that aren't in your repository yet**, chosen to match your tastes — it looks at the tags and ingredients you already cook with and picks the best matches from a built-in library of 26 dishes. Suggestions rotate automatically every week. One click adds a suggestion to your repository.

## Tips

- **Export / Import** buttons (My Recipes tab) back up your recipes to a JSON file or move them to another device.
- Tag your recipes (`chicken`, `italian`, `quick`…) — tags are weighted heavily when picking your weekly suggestions.
- Deleting a recipe also removes it from the current week's plan.

## Files

| File | Purpose |
|---|---|
| `index.html` | App layout and structure |
| `styles.css` | All styling |
| `app.js` | App logic: recipes, planning, grocery aggregation, suggestions, GitHub sync |
| `library.js` | Starter recipes + the discovery library used for weekly suggestions |
| `recipes.json` | Your recipe collection — the permanent, version-controlled home for your recipes |
