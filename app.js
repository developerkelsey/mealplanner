/* ==========================================================================
   Weekly Meal Planner
   All data lives in localStorage under one key. No server, no build step.
   ========================================================================== */

const STORAGE_KEY = "weeklyMealPlanner.v1";
const PEOPLE = 2; // the plan always cooks for two
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/* ---------- state ---------- */

let state = loadState();

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {
    console.warn("Could not read saved data, starting fresh.", e);
  }
  return {
    recipes: STARTER_RECIPES.map((r, i) => ({ ...r, id: "starter-" + i })),
    // plan: array of 7 entries: { recipeId, locked } or null
    plan: DAYS.map(() => null),
    checkedGrocery: {},       // "item|unit" -> true, persists checkbox state
    suggestionOffset: 0,      // bumped by "show me different ones"
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const getRecipe = (id) => state.recipes.find((r) => r.id === id);

/* ---------- quantity helpers ---------- */

// Scale a per-recipe quantity to the amount needed for PEOPLE servings.
const scaleQty = (qty, recipeServings) => qty * (PEOPLE / recipeServings);

// Show numbers like a cook would: 0.5 -> ½, 1.33 -> 1⅓, 2 -> 2
function formatQty(n) {
  const whole = Math.floor(n);
  const frac = n - whole;
  const fractions = [
    [0.125, "⅛"], [0.25, "¼"], [0.33, "⅓"], [0.375, "⅜"], [0.5, "½"],
    [0.625, "⅝"], [0.66, "⅔"], [0.67, "⅔"], [0.75, "¾"], [0.875, "⅞"],
  ];
  let fracStr = "";
  if (frac > 0.01) {
    let best = null;
    for (const [v, s] of fractions) {
      const d = Math.abs(frac - v);
      if (d < 0.04 && (!best || d < best.d)) best = { d, s };
    }
    if (best) fracStr = best.s;
    else return String(Math.round(n * 100) / 100);
  }
  if (whole === 0 && fracStr) return fracStr;
  return fracStr ? `${whole}${fracStr}` : String(whole);
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

/* ---------- toast ---------- */

let toastTimer;
function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2400);
}

/* ==========================================================================
   TAB NAVIGATION
   ========================================================================== */

document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
    document.querySelectorAll(".tab-panel").forEach((p) =>
      p.classList.toggle("active", p.id === "tab-" + btn.dataset.tab)
    );
  });
});

/* ==========================================================================
   1. RECIPE REPOSITORY
   ========================================================================== */

function renderRecipes() {
  const query = document.getElementById("recipe-search").value.trim().toLowerCase();
  const list = document.getElementById("recipe-list");
  const recipes = state.recipes.filter((r) => {
    if (!query) return true;
    return (
      r.name.toLowerCase().includes(query) ||
      (r.tags || []).some((t) => t.toLowerCase().includes(query)) ||
      r.ingredients.some((i) => i.item.toLowerCase().includes(query))
    );
  });

  if (recipes.length === 0) {
    list.innerHTML = `<p class="empty">${
      state.recipes.length === 0
        ? "No recipes yet — click <strong>+ Add Recipe</strong> to start your repository."
        : "No recipes match your search."
    }</p>`;
    return;
  }

  list.innerHTML = recipes
    .map(
      (r) => `
      <div class="card recipe-card">
        <div class="card-top">
          <h3>${escapeHtml(r.name)}</h3>
          <span class="servings-pill">Makes ${r.servings} serving${r.servings === 1 ? "" : "s"}</span>
        </div>
        <div class="tag-row">${(r.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        <ul class="ingredient-list">
          ${r.ingredients
            .map((i) => `<li><span class="qty">${formatQty(i.qty)} ${escapeHtml(i.unit)}</span> ${escapeHtml(i.item)}</li>`)
            .join("")}
        </ul>
        <div class="card-actions">
          <button class="btn subtle small" data-edit="${r.id}">Edit</button>
          <button class="btn danger small" data-delete="${r.id}">Delete</button>
        </div>
      </div>`
    )
    .join("");

  list.querySelectorAll("[data-edit]").forEach((b) =>
    b.addEventListener("click", () => openRecipeModal(getRecipe(b.dataset.edit)))
  );
  list.querySelectorAll("[data-delete]").forEach((b) =>
    b.addEventListener("click", () => {
      const r = getRecipe(b.dataset.delete);
      if (!confirm(`Delete "${r.name}"?`)) return;
      state.recipes = state.recipes.filter((x) => x.id !== r.id);
      // remove it from the plan too
      state.plan = state.plan.map((d) => (d && d.recipeId === r.id ? null : d));
      saveState();
      renderAll();
      toast(`Deleted ${r.name}`);
    })
  );
}

document.getElementById("recipe-search").addEventListener("input", renderRecipes);

/* ---------- recipe editor modal ---------- */

const modal = document.getElementById("recipe-modal");
let editingId = null;

function ingredientRowHtml(ing = { item: "", qty: "", unit: "", category: "Other" }) {
  const cats = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Pantry", "Frozen", "Other"];
  return `
    <div class="ing-row">
      <input type="text" class="ing-item" placeholder="Ingredient" value="${escapeHtml(ing.item)}" />
      <input type="number" class="ing-qty" placeholder="Qty" min="0" step="any" value="${ing.qty}" />
      <input type="text" class="ing-unit" placeholder="Unit (cup, lb…)" value="${escapeHtml(ing.unit)}" />
      <select class="ing-cat">${cats
        .map((c) => `<option ${c === ing.category ? "selected" : ""}>${c}</option>`)
        .join("")}</select>
      <button type="button" class="btn danger small ing-remove" title="Remove">✕</button>
    </div>`;
}

function addIngredientRow(ing) {
  const holder = document.getElementById("ingredient-rows");
  holder.insertAdjacentHTML("beforeend", ingredientRowHtml(ing));
  const row = holder.lastElementChild;
  row.querySelector(".ing-remove").addEventListener("click", () => row.remove());
}

function openRecipeModal(recipe = null) {
  editingId = recipe ? recipe.id : null;
  document.getElementById("modal-title").textContent = recipe ? "Edit Recipe" : "Add Recipe";
  document.getElementById("f-name").value = recipe ? recipe.name : "";
  document.getElementById("f-servings").value = recipe ? recipe.servings : 4;
  document.getElementById("f-tags").value = recipe ? (recipe.tags || []).join(", ") : "";
  document.getElementById("ingredient-rows").innerHTML = "";
  (recipe ? recipe.ingredients : [undefined, undefined, undefined]).forEach((i) => addIngredientRow(i));
  modal.showModal();
}

document.getElementById("btn-new-recipe").addEventListener("click", () => openRecipeModal());
document.getElementById("btn-add-ingredient").addEventListener("click", () => addIngredientRow());
document.getElementById("btn-cancel-modal").addEventListener("click", () => modal.close());

document.getElementById("recipe-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const ingredients = [...document.querySelectorAll("#ingredient-rows .ing-row")]
    .map((row) => ({
      item: row.querySelector(".ing-item").value.trim(),
      qty: parseFloat(row.querySelector(".ing-qty").value) || 0,
      unit: row.querySelector(".ing-unit").value.trim(),
      category: row.querySelector(".ing-cat").value,
    }))
    .filter((i) => i.item);

  if (ingredients.length === 0) {
    toast("Add at least one ingredient.");
    return;
  }

  const recipe = {
    id: editingId || uid(),
    name: document.getElementById("f-name").value.trim(),
    servings: parseInt(document.getElementById("f-servings").value, 10) || 1,
    tags: document.getElementById("f-tags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    ingredients,
  };

  if (editingId) {
    state.recipes = state.recipes.map((r) => (r.id === editingId ? recipe : r));
  } else {
    state.recipes.push(recipe);
  }
  saveState();
  modal.close();
  renderAll();
  toast(`Saved ${recipe.name}`);
});

/* ---------- import / export ---------- */

document.getElementById("btn-export").addEventListener("click", () => {
  const blob = new Blob([JSON.stringify(state.recipes, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "my-recipes.json";
  a.click();
  URL.revokeObjectURL(a.href);
});

document.getElementById("btn-import").addEventListener("click", () => document.getElementById("import-file").click());
document.getElementById("import-file").addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (!file) return;
  file.text().then((text) => {
    try {
      const imported = JSON.parse(text);
      if (!Array.isArray(imported)) throw new Error("not an array");
      let added = 0;
      for (const r of imported) {
        if (!r.name || !Array.isArray(r.ingredients)) continue;
        state.recipes.push({ ...r, id: uid() });
        added++;
      }
      saveState();
      renderAll();
      toast(`Imported ${added} recipe${added === 1 ? "" : "s"}`);
    } catch {
      toast("Couldn't read that file — expected a JSON export from this app.");
    }
    e.target.value = "";
  });
});

/* ==========================================================================
   2. WEEKLY PLAN (scaled for 2 people)
   ========================================================================== */

function pickRecipesForWeek() {
  // Prefer no repeats; if fewer than 7 recipes exist, cycle through them.
  const lockedIds = state.plan.filter((d) => d && d.locked).map((d) => d.recipeId);
  const pool = state.recipes.filter((r) => !lockedIds.includes(r.id));
  const shuffled = [...pool].sort(() => Math.random() - 0.5);

  return state.plan.map((day, i) => {
    if (day && day.locked) return day;
    if (state.recipes.length === 0) return null;
    const pick = shuffled.length > 0 ? shuffled[i % shuffled.length] : state.recipes[i % state.recipes.length];
    // rotate the pool so cycling repeats spread out when recipes < 7
    if (shuffled.length > 0 && shuffled.length < 7) shuffled.push(shuffled.shift());
    return { recipeId: pick.id, locked: false };
  });
}

document.getElementById("btn-generate").addEventListener("click", () => {
  if (state.recipes.length === 0) {
    toast("Add some recipes first!");
    return;
  }
  state.plan = pickRecipesForWeek();
  state.checkedGrocery = {}; // new week, fresh list
  saveState();
  renderAll();
  toast("New week planned! 🎉");
});

document.getElementById("btn-clear-plan").addEventListener("click", () => {
  state.plan = DAYS.map(() => null);
  state.checkedGrocery = {};
  saveState();
  renderAll();
});

function swapDay(dayIndex) {
  const current = state.plan[dayIndex];
  const usedIds = state.plan.filter((d, i) => d && i !== dayIndex).map((d) => d.recipeId);
  let candidates = state.recipes.filter(
    (r) => !usedIds.includes(r.id) && (!current || r.id !== current.recipeId)
  );
  if (candidates.length === 0) {
    candidates = state.recipes.filter((r) => !current || r.id !== current.recipeId);
  }
  if (candidates.length === 0) {
    toast("No other recipe to swap in — add more recipes.");
    return;
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  state.plan[dayIndex] = { recipeId: pick.id, locked: false };
  saveState();
  renderAll();
}

function renderPlan() {
  const holder = document.getElementById("plan-list");
  const hasAny = state.plan.some(Boolean);

  holder.innerHTML = DAYS.map((day, i) => {
    const entry = state.plan[i];
    const recipe = entry && getRecipe(entry.recipeId);
    if (!recipe) {
      return `
        <div class="card day-card empty-day">
          <div class="day-name">${day}</div>
          <p class="muted">${hasAny ? "Nothing planned" : "Click “Generate Week” to fill the week"}</p>
        </div>`;
    }
    const scale = PEOPLE / recipe.servings;
    const scaleNote =
      Math.abs(scale - 1) < 0.001
        ? "recipe makes exactly 2 servings"
        : scale < 1
        ? `make ${formatQty(scale)}× the recipe (it serves ${recipe.servings})`
        : `make ${formatQty(scale)}× the recipe`;
    return `
      <div class="card day-card ${entry.locked ? "locked" : ""}">
        <div class="day-name">${day}</div>
        <h3>${escapeHtml(recipe.name)}</h3>
        <p class="scale-note">${PEOPLE} servings — ${scaleNote}</p>
        <div class="tag-row">${(recipe.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        <div class="card-actions">
          <button class="btn subtle small" data-lock="${i}" title="${entry.locked ? "Unlock" : "Keep this when re-generating"}">
            ${entry.locked ? "🔒 Kept" : "🔓 Keep"}
          </button>
          <button class="btn subtle small" data-swap="${i}" title="Swap for a different recipe">🔄 Swap</button>
        </div>
      </div>`;
  }).join("");

  holder.querySelectorAll("[data-lock]").forEach((b) =>
    b.addEventListener("click", () => {
      const entry = state.plan[b.dataset.lock];
      entry.locked = !entry.locked;
      saveState();
      renderPlan();
    })
  );
  holder.querySelectorAll("[data-swap]").forEach((b) =>
    b.addEventListener("click", () => swapDay(Number(b.dataset.swap)))
  );
}

/* ==========================================================================
   3. GROCERY LIST — aggregated from the plan, scaled for 2
   ========================================================================== */

function buildGroceryList() {
  // key: item + unit (lowercased) so "2 cup broccoli" combines across recipes
  const map = new Map();
  for (const entry of state.plan) {
    if (!entry) continue;
    const recipe = getRecipe(entry.recipeId);
    if (!recipe) continue;
    for (const ing of recipe.ingredients) {
      const key = `${ing.item.toLowerCase().trim()}|${(ing.unit || "").toLowerCase().trim()}`;
      const scaled = scaleQty(ing.qty, recipe.servings);
      if (map.has(key)) {
        const existing = map.get(key);
        existing.qty += scaled;
        if (!existing.recipes.includes(recipe.name)) existing.recipes.push(recipe.name);
      } else {
        map.set(key, {
          key,
          item: ing.item,
          unit: ing.unit || "",
          qty: scaled,
          category: ing.category || "Other",
          recipes: [recipe.name],
        });
      }
    }
  }
  return [...map.values()];
}

const CATEGORY_ORDER = ["Produce", "Meat & Seafood", "Dairy & Eggs", "Bakery", "Frozen", "Pantry", "Other"];

function renderGrocery() {
  const holder = document.getElementById("grocery-list");
  const items = buildGroceryList();

  if (items.length === 0) {
    holder.innerHTML = `<p class="empty">Your grocery list appears here once you generate a weekly plan.</p>`;
    return;
  }

  const byCategory = {};
  for (const it of items) (byCategory[it.category] ||= []).push(it);

  holder.innerHTML = CATEGORY_ORDER.filter((c) => byCategory[c])
    .map((cat) => {
      const rows = byCategory[cat]
        .sort((a, b) => a.item.localeCompare(b.item))
        .map((it) => {
          const checked = state.checkedGrocery[it.key] ? "checked" : "";
          return `
          <li class="grocery-item ${checked ? "done" : ""}">
            <label>
              <input type="checkbox" data-key="${escapeHtml(it.key)}" ${checked} />
              <span class="g-qty">${formatQty(it.qty)}${it.unit ? " " + escapeHtml(it.unit) : ""}</span>
              <span class="g-name">${escapeHtml(it.item)}</span>
              <span class="g-for muted">for ${it.recipes.map(escapeHtml).join(", ")}</span>
            </label>
          </li>`;
        })
        .join("");
      return `<div class="grocery-group"><h3>${cat}</h3><ul>${rows}</ul></div>`;
    })
    .join("");

  holder.querySelectorAll("input[type=checkbox]").forEach((cb) =>
    cb.addEventListener("change", () => {
      state.checkedGrocery[cb.dataset.key] = cb.checked;
      if (!cb.checked) delete state.checkedGrocery[cb.dataset.key];
      cb.closest(".grocery-item").classList.toggle("done", cb.checked);
      saveState();
    })
  );
}

document.getElementById("btn-copy-grocery").addEventListener("click", () => {
  const items = buildGroceryList();
  if (items.length === 0) return toast("Nothing to copy yet.");
  const byCategory = {};
  for (const it of items) (byCategory[it.category] ||= []).push(it);
  const text = CATEGORY_ORDER.filter((c) => byCategory[c])
    .map(
      (cat) =>
        `${cat.toUpperCase()}\n` +
        byCategory[cat]
          .sort((a, b) => a.item.localeCompare(b.item))
          .map((it) => `  - ${formatQty(it.qty)}${it.unit ? " " + it.unit : ""} ${it.item}`)
          .join("\n")
    )
    .join("\n\n");
  navigator.clipboard.writeText(text).then(
    () => toast("Grocery list copied!"),
    () => toast("Couldn't copy — your browser blocked it.")
  );
});

document.getElementById("btn-print-grocery").addEventListener("click", () => window.print());

/* ==========================================================================
   4. WEEKLY SUGGESTIONS — 2 new recipes matched to your tastes
   ========================================================================== */

// ISO week number: suggestions rotate automatically each week.
function isoWeek(date = new Date()) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function tasteScore(candidate) {
  // Build a taste profile from what the user already cooks: every tag and
  // ingredient in their repository, weighted by how often it appears.
  const tagCounts = {};
  const ingCounts = {};
  for (const r of state.recipes) {
    for (const t of r.tags || []) tagCounts[t.toLowerCase()] = (tagCounts[t.toLowerCase()] || 0) + 1;
    for (const i of r.ingredients) {
      const k = i.item.toLowerCase();
      ingCounts[k] = (ingCounts[k] || 0) + 1;
    }
  }
  let score = 0;
  for (const t of candidate.tags || []) score += (tagCounts[t.toLowerCase()] || 0) * 3; // tags weigh more
  for (const i of candidate.ingredients) score += ingCounts[i.item.toLowerCase()] || 0;
  return score;
}

function weeklySuggestions() {
  const ownedNames = new Set(state.recipes.map((r) => r.name.toLowerCase()));
  const candidates = DISCOVER_LIBRARY.filter((c) => !ownedNames.has(c.name.toLowerCase()));
  if (candidates.length === 0) return [];

  // Rank by taste match, then rotate through the top matches by week number
  // (plus any manual "show me different ones" clicks) so picks change weekly
  // but stay aligned with the user's tastes.
  const ranked = [...candidates].sort((a, b) => tasteScore(b) - tasteScore(a));
  const topPool = ranked.slice(0, Math.min(10, ranked.length));
  const offset = ((isoWeek() + state.suggestionOffset) * 2) % topPool.length;
  const first = topPool[offset];
  const second = topPool[(offset + 1) % topPool.length];
  return second && second !== first ? [first, second] : [first];
}

function renderSuggestions() {
  const holder = document.getElementById("suggestion-list");
  const picks = weeklySuggestions();

  if (picks.length === 0) {
    holder.innerHTML = `<p class="empty">You've added every recipe in the discovery library — impressive! 🎉</p>`;
    return;
  }

  holder.innerHTML = picks
    .map(
      (r, idx) => `
      <div class="card recipe-card suggestion-card">
        <div class="suggestion-label">✨ New this week</div>
        <div class="card-top">
          <h3>${escapeHtml(r.name)}</h3>
          <span class="servings-pill">Makes ${r.servings} servings</span>
        </div>
        <p class="description">${escapeHtml(r.description || "")}</p>
        <div class="tag-row">${(r.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
        <ul class="ingredient-list">
          ${r.ingredients
            .map((i) => `<li><span class="qty">${formatQty(i.qty)} ${escapeHtml(i.unit)}</span> ${escapeHtml(i.item)}</li>`)
            .join("")}
        </ul>
        <div class="card-actions">
          <button class="btn primary small" data-adopt="${idx}">+ Add to my recipes</button>
        </div>
      </div>`
    )
    .join("");

  holder.querySelectorAll("[data-adopt]").forEach((b) =>
    b.addEventListener("click", () => {
      const pick = picks[Number(b.dataset.adopt)];
      state.recipes.push({ ...pick, id: uid() });
      saveState();
      renderAll();
      toast(`${pick.name} added to your recipes!`);
    })
  );
}

document.getElementById("btn-refresh-suggestions").addEventListener("click", () => {
  state.suggestionOffset += 1;
  saveState();
  renderSuggestions();
});

/* ==========================================================================
   render everything
   ========================================================================== */

function renderAll() {
  renderRecipes();
  renderPlan();
  renderGrocery();
  renderSuggestions();
}

renderAll();
saveState();
