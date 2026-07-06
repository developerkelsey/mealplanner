# 🍽️ Weekly Meal Planner

A simple, personal meal-planning app that runs entirely in your browser — no installs, no accounts, no server.

## How to use it

**Just open `index.html` in any browser.** That's it.

Everything you add is saved automatically in your browser (localStorage), so your recipes and plan are still there next time you open it.

## What it does

### 📖 My Recipes — your recipe repository
Store every recipe with its ingredients, quantities, units, and how many servings it makes. Search by name, tag, or ingredient. The app comes with a few starter recipes you can edit or delete.

### 🗓️ Weekly Plan — dinners for 2, automatically
Click **Generate Week** and the app fills Monday–Sunday with recipes from your repository. Every meal is scaled to **2 servings** — each day shows exactly what fraction or multiple of the recipe to make (e.g. "make ½× the recipe" for a 4-serving dish). Like a day? Click **Keep** to lock it before re-generating. Want something else? **Swap** replaces just that day.

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
| `app.js` | App logic: recipes, planning, grocery aggregation, suggestions |
| `library.js` | Starter recipes + the discovery library used for weekly suggestions |
