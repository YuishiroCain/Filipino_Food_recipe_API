let token = localStorage.getItem("token") || "";
let currentPage = 1;
let pageSize = 5;
let undoStack = [];

function showToast(msg, type = "success") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerText = msg;
  document.getElementById("toast-container").appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

function toggleLoader(show) {
  document.getElementById("loader").style.display = show ? "block" : "none";
}

function addIngredient(val = "") {
  const li = document.createElement("li");
  li.innerHTML = `<input type="text" name="ingredient" value="${val}" required />
                  <button onclick="this.parentElement.remove()">✕</button>`;
  document.getElementById("ingredients-list").appendChild(li);
}

function addStep(val = "") {
  const li = document.createElement("li");
  li.innerHTML = `<input type="text" name="step" value="${val}" required />
                  <button onclick="this.parentElement.remove()">✕</button>`;
  document.getElementById("steps-list").appendChild(li);
}

function previewImage(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const img = document.getElementById("preview");
    img.src = e.target.result;
    img.style.display = "block";
  };
  reader.readAsDataURL(file);
}

function buildQueryParams() {
  const filters = [];
  const query = document.getElementById("search").value;
  const selectedTags = [];
    document.querySelectorAll(".filter-tag-row").forEach(row => {
      const cat = row.querySelector("select").value;
      const val = row.querySelector("input").value;
      if (cat && val) selectedTags.push(`${cat}:${val}`);
      });
  const maxTime = document.getElementById("max-time").value;

  if (selectedTags.length) filters.push(`tag=${encodeURIComponent(selectedTags.join(","))}`);
  if (query) filters.push(`query=${encodeURIComponent(query)}`);
  if (tagCat && tagVal) filters.push(`tag=${encodeURIComponent(`${tagCat}:${tagVal}`)}`);
  if (maxTime) filters.push(`max_time=${maxTime}`);

  filters.push(`from=${(currentPage - 1) * pageSize}`);
  filters.push(`size=${pageSize}`);
  return filters.join("&");
  }

function renderPagination(from, to, count) {
  const totalPages = Math.ceil(count / pageSize);
  const pagination = document.getElementById("pagination");
  pagination.innerHTML = "";

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.innerText = i;
    btn.className = i === currentPage ? "active page-btn" : "page-btn";
    btn.onclick = () => {
      currentPage = i;
      fetchRecipes();
    };
    pagination.appendChild(btn);
  }
}

function highlightActiveTags() {
  const tagSet = new Set();
  document.querySelectorAll(".filter-tag-row").forEach(row => {
    const cat = row.querySelector("select").value;
    const val = row.querySelector("input").value.trim().toLowerCase();
    if (cat && val) tagSet.add(`${cat}:${val}`);
  });

  document.querySelectorAll(".tag").forEach(tagEl => {
    const tagKey = `${tagEl.dataset.cat}:${tagEl.dataset.val}`.toLowerCase();
    tagEl.classList.toggle("active", tagSet.has(tagKey));
  });
}

async function fetchRecipes() {
  toggleLoader(true);
  const res = await fetch(`http://localhost:8000/recipes?${buildQueryParams()}`);
  const data = await res.json();
  const container = document.getElementById("recipes");

  if (!data.hits || data.hits.length === 0) {
    container.innerHTML = `<p>No recipes found.</p>`;
    highlightActiveTags();
    toggleLoader(false);
    return;
  }

  container.innerHTML = data.hits.map(r => `
    <div class="recipe">
      <h2>${r.title}</h2>
      ${r.image ? `<img src="/images/${r.image}" />` : ""}
      <p><strong>Category:</strong> ${r.category}</p>
      <p>${r.description}</p>
      <p><strong>Prep Time:</strong> ${r.prep_time} min</p>
      <p><strong>Calories:</strong> ${r.calories}</p>
      <ul>${r.ingredients.map(i => `<li>${i}</li>`).join("")}</ul>
      <ol>${r.steps.map(s => `<li>${s}</li>`).join("")}</ol>
      <div class="tags">
        ${(Object.entries(r.tags || {}).flatMap(([cat, vals]) =>
          vals.map(val => `<span class="tag" data-cat="${cat}" data-val="${val}" onclick="onTagClick(this)">${cat}: ${val}</span>`)
        )).join("")}
      </div>

      ${token ? `<button onclick="editRecipe(${r.id})">✏</button>
               <button onclick="deleteRecipe(${r.id})">🗑</button>` : ""}
    </div>
  `).join("");

  renderPagination(data.from, data.to, data.count);
  toggleLoader(false);
}

async function deleteRecipe(id) {
  if (!confirm("Delete this recipe?")) return;
  const res = await fetch(`http://localhost:8000/recipes/${id}`);
  const r = await res.json();
  undoStack.push(r);

  await fetch(`http://localhost:8000/recipes/${id}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` }
  });

  showToast(`Deleted: ${r.title}`);
  fetchRecipes();
}

async function undoDelete() {
  const r = undoStack.pop();
  if (!r) return;

  await fetch("http://localhost:8000/recipes", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` })
    },
    body: JSON.stringify(r)
  });
  showToast(`Restored: ${r.title}`);
  fetchRecipes();
}

document.getElementById("category-form").onsubmit = async e => {
  e.preventDefault();
  const name = document.getElementById("new-category").value.trim();
  if (!name) return;

  const res = await fetch(`http://localhost:8000/categories?name=${encodeURIComponent(name)}`, {
    method: "POST",
    headers: {
      ...(token && { Authorization: `Bearer ${token}` })
    }
  });

  const data = await res.json();
  showToast(data.message || "Category added");

  document.getElementById("new-category").value = "";
  loadCategories();
};

document.getElementById("recipe-form").onsubmit = async function (e) {
  e.preventDefault();
  const errors = [];
  document.getElementById("form-errors").innerHTML = "";

  const id = parseInt(document.getElementById("id").value);
  const title = document.getElementById("title").value;
  const category = document.getElementById("form-category").value;
  const description = document.getElementById("description").value;
  const prep_time = parseInt(document.getElementById("prep-time").value);
  const calories = parseInt(document.getElementById("calories").value);
  const ingredients = [...document.querySelectorAll("[name='ingredient']")].map(i => i.value);
  const steps = [...document.querySelectorAll("[name='step']")].map(s => s.value);

  // 🔁 Structured tags
  const tagInputs = document.querySelectorAll('[data-tag-category]');
  const tags = {};
  tagInputs.forEach(input => {
    const category = input.dataset.tagCategory;
    const values = input.value.split(",").map(t => t.trim()).filter(Boolean);
    if (values.length > 0) tags[category] = values;
  });

  if (!title) errors.push("Title is required.");
  if (!description) errors.push("Description is required.");
  if (!category) errors.push("Category is required.");
  if (isNaN(prep_time)) errors.push("Prep time must be a number.");
  if (isNaN(calories)) errors.push("Calories must be a number.");
  if (ingredients.length === 0 || ingredients.some(i => !i)) errors.push("At least one valid ingredient required.");
  if (steps.length === 0 || steps.some(s => !s)) errors.push("At least one valid step required.");

  if (errors.length > 0) {
    document.getElementById("form-errors").innerHTML = `<ul>${errors.map(e => `<li>${e}</li>`).join("")}</ul>`;
    showToast("Please fix errors", "error");
    return;
  }

  let image = null;
  const imageFile = document.getElementById("image").files[0];
  if (imageFile) {
    const formData = new FormData();
    formData.append("file", imageFile);
    const res = await fetch("http://localhost:8000/upload-image", { method: "POST", body: formData });
    const data = await res.json();
    image = data.filename;
  }

  const recipe = {
    id, title, category, description, prep_time, calories,
    tags, ingredients, steps, image,
    servings: 1, source: "", diet_labels: []
  };

  const check = await fetch(`http://localhost:8000/recipes/${id}`);
  const exists = check.ok;
  const method = exists ? "PUT" : "POST";
  const url = exists ? `http://localhost:8000/recipes/${id}` : `http://localhost:8000/recipes`;

  if (exists && !confirm("Overwrite existing recipe?")) return;

  await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token && { Authorization: `Bearer ${token}` })
    },
    body: JSON.stringify(recipe)
  });

  showToast("Recipe saved");
  cancelEdit();
  fetchRecipes();
};

function cancelEdit() {
  document.getElementById("recipe-form").reset();
  document.getElementById("ingredients-list").innerHTML = "";
  document.getElementById("steps-list").innerHTML = "";
  document.getElementById("preview").style.display = "none";
  document.getElementById("modal-overlay").classList.remove("active");
  document.body.style.overflow = "";
  document.getElementById("form-errors").innerHTML = "";
}

async function editRecipe(id) {
  const res = await fetch(`http://localhost:8000/recipes/${id}`);
  const r = await res.json();
  document.getElementById("modal-overlay").classList.add("active");
  document.body.style.overflow = "hidden";
  document.getElementById("id").value = r.id;
  document.getElementById("title").value = r.title;
  document.getElementById("form-category").value = r.category;
  document.getElementById("description").value = r.description;
  document.getElementById("prep-time").value = r.prep_time;
  document.getElementById("calories").value = r.calories;
  document.getElementById("preview").src = r.image ? `/images/${r.image}` : "";
  document.getElementById("preview").style.display = r.image ? "block" : "none";

  document.getElementById("ingredients-list").innerHTML = "";
  r.ingredients.forEach(addIngredient);
  document.getElementById("steps-list").innerHTML = "";
  r.steps.forEach(addStep);

  // Populate structured tags
  const tagInputs = document.querySelectorAll('[data-tag-category]');
  tagInputs.forEach(input => {
    const cat = input.dataset.tagCategory;
    input.value = (r.tags[cat] || []).join(", ");
  });
}

async function loadCategories() {
  const res = await fetch("http://localhost:8000/categories?app-id=demo&app_key=demo123");
  const cats = await res.json();

  document.getElementById("category-filters").innerHTML =
    cats.map(c => `<label><input type="checkbox" value="${c}" name="filter-category"> ${c}</label>`).join("");

  const sel = document.getElementById("form-category");
  sel.innerHTML = `<option value="">Select Category</option>` +
    cats.map(c => `<option value="${c}">${c}</option>`).join("");
}

document.getElementById("drop-zone").addEventListener("dragover", function (e) {
  e.preventDefault();
  this.classList.add("dragover");
});
document.getElementById("drop-zone").addEventListener("dragleave", function () {
  this.classList.remove("dragover");
});
document.getElementById("drop-zone").addEventListener("drop", function (e) {
  e.preventDefault();
  this.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) {
    document.getElementById("image").files = e.dataTransfer.files;
    previewImage(file);
  }
});

document.getElementById("new-recipe-btn").onclick = () => {
  cancelEdit();
  document.getElementById("modal-overlay").classList.add("active");
  document.body.style.overflow = "hidden";
};

document.getElementById("search").addEventListener("input", () => {
  currentPage = 1;
  setTimeout(fetchRecipes, 300);
});
document.getElementById("sort").addEventListener("change", fetchRecipes);
document.getElementById("tag-category").addEventListener("change", fetchRecipes);
document.getElementById("tag-value").addEventListener("input", () => {
  currentPage = 1;
  setTimeout(fetchRecipes, 300);
});
document.getElementById("max-time").addEventListener("input", fetchRecipes);

document.getElementById("login-form").onsubmit = async e => {
  e.preventDefault();
  const fd = new FormData(e.target);
  const res = await fetch("http://localhost:8000/token", { method: "POST", body: fd });
  const data = await res.json();

  if (data.access_token) {
    token = data.access_token;
    localStorage.setItem("token", token);
    document.getElementById("admin-panel").style.display = "block";
    loadCategories();
    showToast("Logged in successfully", "success");
  } else {
    showToast("Login failed", "error");
  }
};

const backBtn = document.createElement("button");
backBtn.className = "icon-button";
backBtn.innerText = "⬆ Back to Top";
backBtn.onclick = () => window.scrollTo({ top: 0, behavior: "smooth" });
document.body.appendChild(backBtn);

function addTagFilterRow(cat = "", val = "") {
  const existing = [...document.querySelectorAll(".filter-tag-row")]
    .some(row => row.querySelector("select").value === cat && row.querySelector("input").value === val);

  if (existing) return;

  const container = document.getElementById("tag-filter-container");
  const row = document.createElement("div");
  row.className = "filter-tag-row";
  row.innerHTML = `
    <select>
      <option value="">Choose Tag Category</option>
      <option>Cooking time</option>
      <option>Ingredients</option>
      <option>Calories</option>
      <option>Diet type</option>
      <option>Health & safety</option>
      <option>Meal type</option>
      <option>Dish type</option>
      <option>Cuisine type</option>
    </select>
    <input type="text" placeholder="Value" />
    <button type="button" onclick="this.parentElement.remove()">✕</button>
  `;
  row.querySelector("select").value = cat;
  row.querySelector("input").value = val;
  container.appendChild(row);
}

function clearAllFilters() {
  document.getElementById("tag-filter-container").innerHTML = "";
  addTagFilterRow(); // add one blank input
  fetchRecipes();    // refresh with no filters
}


function onTagClick(el) {
  const cat = el.dataset.cat;
  const val = el.dataset.val;

  const rows = [...document.querySelectorAll(".filter-tag-row")];
  const existing = rows.find(row =>
    row.querySelector("select").value === cat &&
    row.querySelector("input").value.toLowerCase() === val.toLowerCase()
  );

  if (existing) {
    existing.remove();
  } else {
    addTagFilterRow(cat, val);
  }

  fetchRecipes();
}


window.onload = () => {
  token = localStorage.getItem("token") || "";
  if (token) {
    document.getElementById("admin-panel").style.display = "block";
    loadCategories();
  } else {
    document.getElementById("admin-panel").style.display = "none";
  }

  addTagFilterRow(); // add one filter input at start
  fetchRecipes();
  addIngredient();
  addStep();
};
