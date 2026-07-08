/* ==========================================================================
   Weekly Meal Planner
   All data lives in localStorage under one key. No server, no build step.
   ========================================================================== */

const STORAGE_KEY = "weeklyMealPlanner.v1";
const PEOPLE = 2; // the plan always cooks for two
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const MEALS = ["lunch", "dinner"];
const MEAL_LABEL = { lunch: "☀️ Lunch", dinner: "🌙 Dinner" };
// recipe.meal: "lunch" | "dinner" | "both" — which slots a recipe may fill
const fitsMeal = (recipe, meal) => (recipe.meal || "both") === "both" || recipe.meal === meal;

/* ---------- state ---------- */

let state = loadState();

function emptyPlan() {
  // one entry per day; each meal slot is null or { recipeId, locked }
  return DAYS.map(() => ({ lunch: null, dinner: null }));
}

// Earlier versions planned dinners only (plan entries were { recipeId } or
// null) and recipes had no meal field. Upgrade old saves in place.
function migrate(s) {
  s.dirty ||= false;   // recipes changed since last GitHub save
  s.synced ||= false;  // true once recipes have been saved to / loaded from GitHub
  s.plan = (s.plan || emptyPlan()).map((d) =>
    d && "recipeId" in d ? { lunch: null, dinner: d } : d || { lunch: null, dinner: null }
  );
  while (s.plan.length < DAYS.length) s.plan.push({ lunch: null, dinner: null });
  for (const r of s.recipes || []) r.meal ||= "both";
  s.checkedGrocery ||= {};
  s.suggestionOffset ||= 0;
  return s;
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch (e) {
    console.warn("Could not read saved data, starting fresh.", e);
  }
  return {
    recipes: STARTER_RECIPES.map((r, i) => ({ ...r, id: "starter-" + i })),
    plan: emptyPlan(),
    checkedGrocery: {},       // "item|unit" -> true, persists checkbox state
    suggestionOffset: 0,      // bumped by "show me different ones"
    dirty: false,
    synced: false,
  };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const getRecipe = (id) => state.recipes.find((r) => r.id === id);

// Call whenever recipes change: flags that GitHub has an older copy.
function markDirty() {
  state.dirty = true;
  saveState();
  renderSyncStatus();
}

/* ==========================================================================
   GITHUB SYNC — recipes.json in the repo is the permanent home for recipes.
   The browser's localStorage is only a working cache. The plan and grocery
   checkboxes are weekly ephemera and stay local on purpose.
   ========================================================================== */

const GH_KEY = "weeklyMealPlanner.github";
const GH_DEFAULTS = { owner: "developerkelsey", repo: "mealplanner", branch: "claude/weekly-meal-planner-app-b8vkzk" };
let ghConfig = null;
let ghSha = null; // sha of recipes.json at last load/save, needed to commit updates

try {
  ghConfig = JSON.parse(localStorage.getItem(GH_KEY));
} catch { /* stay unconfigured */ }

function ghUrl() {
  return `https://api.github.com/repos/${ghConfig.owner}/${ghConfig.repo}/contents/recipes.json`;
}

function ghHeaders() {
  return {
    Authorization: `Bearer ${ghConfig.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

// base64 helpers that survive emoji/accents (btoa alone can't)
function toBase64(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromBase64(b64) {
  const bin = atob(b64.replace(/\n/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

// Fetch recipes.json from GitHub. Returns {recipes, sha} or null if missing.
async function ghFetch() {
  const res = await fetch(`${ghUrl()}?ref=${encodeURIComponent(ghConfig.branch)}`, { headers: ghHeaders() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub said ${res.status} — check your token and repo settings.`);
  const data = await res.json();
  const recipes = JSON.parse(fromBase64(data.content));
  if (!Array.isArray(recipes)) throw new Error("recipes.json is not a recipe list.");
  for (const r of recipes) r.id ||= uid();
  return { recipes, sha: data.sha };
}

// Commit the current recipes to GitHub. Retries once on a sha conflict.
async function ghSave(isRetry = false) {
  const body = {
    message: `Update recipes (${state.recipes.length} recipes)`,
    content: toBase64(JSON.stringify(state.recipes, null, 2) + "\n"),
    branch: ghConfig.branch,
  };
  if (ghSha) body.sha = ghSha;
  const res = await fetch(ghUrl(), { method: "PUT", headers: ghHeaders(), body: JSON.stringify(body) });
  if ((res.status === 409 || res.status === 422) && !isRetry) {
    // someone (or another device) changed the file since we last looked
    const remote = await ghFetch();
    ghSha = remote ? remote.sha : null;
    if (!confirm("recipes.json changed on GitHub since this device last synced. Overwrite it with this device's recipes?")) {
      throw new Error("Save cancelled — GitHub copy left untouched.");
    }
    return ghSave(true);
  }
  if (!res.ok) throw new Error(`GitHub said ${res.status} — check your token and repo settings.`);
  const data = await res.json();
  ghSha = data.content.sha;
  state.dirty = false;
  state.synced = true;
  saveState();
}

function renderSyncStatus() {
  const el = document.getElementById("sync-status");
  if (!ghConfig) {
    el.textContent = "☁️ Recipes not backed up — set up GitHub sync";
    el.className = "sync-pill warn";
    return;
  }
  if (state.dirty || !state.synced) {
    el.textContent = "● Unsaved changes — click Save to GitHub";
    el.className = "sync-pill warn";
  } else {
    el.textContent = "✅ Recipes saved to GitHub";
    el.className = "sync-pill ok";
  }
}

// On startup: pull recipes from GitHub. Never clobbers local recipes that
// haven't been synced yet (protects collections from before sync existed,
// and unsaved edits).
async function initSync() {
  renderSyncStatus();
  if (!ghConfig) return;
  try {
    const remote = await ghFetch();
    if (!remote) return; // no recipes.json yet — first Save will create it
    ghSha = remote.sha;
    if (state.synced && !state.dirty) {
      state.recipes = remote.recipes;
      saveState();
      renderAll();
    }
    renderSyncStatus();
  } catch (e) {
    toast(e.message);
  }
}

document.getElementById("btn-save-github").addEventListener("click", async () => {
  if (!ghConfig) {
    openSyncModal();
    return;
  }
  const btn = document.getElementById("btn-save-github");
  btn.disabled = true;
  try {
    if (ghSha === null) {
      const remote = await ghFetch();
      if (remote) ghSha = remote.sha;
    }
    await ghSave();
    renderSyncStatus();
    toast("Recipes saved to GitHub! ✅");
  } catch (e) {
    toast(e.message);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- sync settings modal ---------- */

const syncModal = document.getElementById("sync-modal");

function openSyncModal() {
  const cfg = ghConfig || GH_DEFAULTS;
  document.getElementById("gh-token").value = ghConfig ? ghConfig.token : "";
  document.getElementById("gh-owner").value = cfg.owner;
  document.getElementById("gh-repo").value = cfg.repo;
  document.getElementById("gh-branch").value = cfg.branch;
  syncModal.showModal();
}

document.getElementById("btn-sync-settings").addEventListener("click", openSyncModal);
document.getElementById("sync-status").addEventListener("click", () => {
  if (!ghConfig) openSyncModal();
});
document.getElementById("btn-cancel-sync").addEventListener("click", () => syncModal.close());

document.getElementById("sync-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  ghConfig = {
    token: document.getElementById("gh-token").value.trim(),
    owner: document.getElementById("gh-owner").value.trim(),
    repo: document.getElementById("gh-repo").value.trim(),
    branch: document.getElementById("gh-branch").value.trim(),
  };
  localStorage.setItem(GH_KEY, JSON.stringify(ghConfig));
  ghSha = null;
  syncModal.close();
  renderSyncStatus();
  // Validate the connection, but keep this device's recipes — the user
  // decides what to push/pull via the buttons.
  try {
    const remote = await ghFetch();
    if (remote) ghSha = remote.sha;
    toast("Connected to GitHub! Click “Save to GitHub” to back up your recipes.");
  } catch (err) {
    toast(err.message);
  }
});

document.getElementById("btn-load-github").addEventListener("click", async () => {
  if (!ghConfig) return toast("Set up the connection first.");
  try {
    const remote = await ghFetch();
    if (!remote) return toast("No recipes.json on GitHub yet — save first.");
    if (!confirm(`Replace this device's ${state.recipes.length} recipes with the ${remote.recipes.length} recipes on GitHub?`)) return;
    ghSha = remote.sha;
    state.recipes = remote.recipes;
    state.dirty = false;
    state.synced = true;
    saveState();
    syncModal.close();
    renderAll();
    renderSyncStatus();
    toast("Recipes loaded from GitHub!");
  } catch (e) {
    toast(e.message);
  }
});

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

function mealPill(recipe) {
  const label = { lunch: "☀️ lunch", dinner: "🌙 dinner", both: "☀️🌙 lunch or dinner" }[recipe.meal || "both"];
  return `<span class="tag meal-tag">${label}</span>`;
}

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
        <div class="tag-row">${mealPill(r)}${(r.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
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
      for (const day of state.plan)
        for (const m of MEALS) if (day[m] && day[m].recipeId === r.id) day[m] = null;
      markDirty();
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
  document.getElementById("f-meal").value = recipe ? recipe.meal || "both" : "both";
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
    meal: document.getElementById("f-meal").value,
    tags: document.getElementById("f-tags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
    ingredients,
  };

  if (editingId) {
    state.recipes = state.recipes.map((r) => (r.id === editingId ? recipe : r));
  } else {
    state.recipes.push(recipe);
  }
  markDirty();
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
      markDirty();
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
  // Fill every lunch and dinner slot, preferring no repeats across the week.
  // If there aren't enough fitting recipes for 7 of each, repeats are allowed
  // (but never the same recipe for both meals of one day).
  const used = new Set();
  for (const day of state.plan)
    for (const m of MEALS) if (day[m] && day[m].locked) used.add(day[m].recipeId);

  return state.plan.map((day) => {
    const newDay = { ...day };
    for (const meal of MEALS) {
      if (newDay[meal] && newDay[meal].locked) continue;
      const fits = state.recipes.filter((r) => fitsMeal(r, meal));
      if (fits.length === 0) {
        newDay[meal] = null;
        continue;
      }
      let pool = fits.filter((r) => !used.has(r.id));
      if (pool.length === 0) {
        const otherMeal = meal === "lunch" ? "dinner" : "lunch";
        const otherId = newDay[otherMeal] && newDay[otherMeal].recipeId;
        pool = fits.filter((r) => r.id !== otherId);
        if (pool.length === 0) pool = fits;
      }
      const pick = pool[Math.floor(Math.random() * pool.length)];
      used.add(pick.id);
      newDay[meal] = { recipeId: pick.id, locked: false };
    }
    return newDay;
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
  state.plan = emptyPlan();
  state.checkedGrocery = {};
  saveState();
  renderAll();
});

function swapSlot(dayIndex, meal) {
  const current = state.plan[dayIndex][meal];
  const usedIds = new Set();
  state.plan.forEach((day, i) =>
    MEALS.forEach((m) => {
      const e = day[m];
      if (e && !(i === dayIndex && m === meal)) usedIds.add(e.recipeId);
    })
  );
  const fits = state.recipes.filter(
    (r) => fitsMeal(r, meal) && (!current || r.id !== current.recipeId)
  );
  let candidates = fits.filter((r) => !usedIds.has(r.id));
  if (candidates.length === 0) candidates = fits;
  if (candidates.length === 0) {
    toast(`No other ${meal} recipe to swap in — add more recipes.`);
    return;
  }
  const pick = candidates[Math.floor(Math.random() * candidates.length)];
  state.plan[dayIndex][meal] = { recipeId: pick.id, locked: false };
  saveState();
  renderAll();
}

function renderPlan() {
  const holder = document.getElementById("plan-list");
  const hasAny = state.plan.some((d) => d.lunch || d.dinner);

  holder.innerHTML = DAYS.map((day, i) => {
    const slots = MEALS.map((meal) => {
      const entry = state.plan[i][meal];
      const recipe = entry && getRecipe(entry.recipeId);
      if (!recipe) {
        return `
          <div class="meal-slot">
            <div class="meal-label">${MEAL_LABEL[meal]}</div>
            <p class="muted small-note">${hasAny ? "Nothing planned" : "Click “Generate Week” to fill it"}</p>
          </div>`;
      }
      const scale = PEOPLE / recipe.servings;
      const scaleNote =
        Math.abs(scale - 1) < 0.001
          ? "recipe makes exactly 2 servings"
          : `make ${formatQty(scale)}× the recipe (it serves ${recipe.servings})`;
      return `
        <div class="meal-slot ${entry.locked ? "locked" : ""}">
          <div class="meal-label">${MEAL_LABEL[meal]}</div>
          <h3>${escapeHtml(recipe.name)}</h3>
          <p class="scale-note">${PEOPLE} servings — ${scaleNote}</p>
          <div class="card-actions">
            <button class="btn subtle small" data-lock="${i}:${meal}" title="${entry.locked ? "Unlock" : "Keep this when re-generating"}">
              ${entry.locked ? "🔒 Kept" : "🔓 Keep"}
            </button>
            <button class="btn subtle small" data-swap="${i}:${meal}" title="Swap for a different recipe">🔄 Swap</button>
          </div>
        </div>`;
    }).join("");
    return `
      <div class="card day-card">
        <div class="day-name">${day}</div>
        ${slots}
      </div>`;
  }).join("");

  holder.querySelectorAll("[data-lock]").forEach((b) =>
    b.addEventListener("click", () => {
      const [i, meal] = b.dataset.lock.split(":");
      const entry = state.plan[Number(i)][meal];
      entry.locked = !entry.locked;
      saveState();
      renderPlan();
    })
  );
  holder.querySelectorAll("[data-swap]").forEach((b) =>
    b.addEventListener("click", () => {
      const [i, meal] = b.dataset.swap.split(":");
      swapSlot(Number(i), meal);
    })
  );
}

/* ==========================================================================
   3. GROCERY LIST — aggregated from the plan, scaled for 2
   ========================================================================== */

function buildGroceryList() {
  // key: item + unit (lowercased) so "2 cup broccoli" combines across recipes
  const map = new Map();
  const entries = state.plan.flatMap((day) => MEALS.map((m) => day[m]));
  for (const entry of entries) {
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
        <div class="tag-row">${mealPill(r)}${(r.tags || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join("")}</div>
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
      markDirty();
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
initSync();
