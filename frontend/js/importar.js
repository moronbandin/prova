import { getTerritorios } from "./api.js";
import { qs, nl2br, normalizeText } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

let knownTerritories = [];
let knownTerritoryIds = new Set();
let territoryMapById = new Map();
let state = { coplas: [] };

function emptyCopla() {
  return {
    text: "",
    notes: "",
    tags: [],
    territories: []
  };
}

function cloneState(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function makeIncipit(text = "", maxWords = 6) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "(sen texto)";
  return words.slice(0, maxWords).join(" ");
}

function getTerritoryLabelById(id) {
  const terr = territoryMapById.get(id);
  if (!terr) return id;
  return terr.nome;
}

function syncTextareaFromState() {
  const input = qs("#json-input");
  if (!input) return;
  input.value = JSON.stringify(state, null, 2);
}

function updateEditorSummary() {
  const el = qs("#editor-summary");
  if (!el) return;
  el.textContent = `${state.coplas.length} copla(s) no editor`;
}

function validatePayload(payload) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push("A raíz do JSON debe ser un obxecto.");
    return { errors, warnings };
  }

  if (!Array.isArray(payload.coplas)) {
    errors.push("A clave 'coplas' debe existir e ser unha lista.");
    return { errors, warnings };
  }

  payload.coplas.forEach((copla, index) => {
    const n = index + 1;

    if (!copla || typeof copla !== "object" || Array.isArray(copla)) {
      errors.push(`Copla #${n}: debe ser un obxecto.`);
      return;
    }

    if (typeof copla.text !== "string" || !copla.text.trim()) {
      errors.push(`Copla #${n}: falta 'text' ou está baleiro.`);
    }

    if (!("notes" in copla) || typeof copla.notes !== "string") {
      errors.push(`Copla #${n}: 'notes' debe existir e ser string.`);
    }

    if (!Array.isArray(copla.tags)) {
      errors.push(`Copla #${n}: 'tags' debe ser unha lista.`);
    } else {
      copla.tags.forEach((tag, i) => {
        if (typeof tag !== "string") {
          errors.push(`Copla #${n}: etiqueta #${i + 1} non é string.`);
        }
      });
    }

    if (!Array.isArray(copla.territories)) {
      errors.push(`Copla #${n}: 'territories' debe ser unha lista.`);
    } else {
      copla.territories.forEach((t, i) => {
        if (!t || typeof t !== "object" || Array.isArray(t)) {
          errors.push(`Copla #${n}: territorio #${i + 1} non é un obxecto.`);
          return;
        }

        if (typeof t.id !== "string" || !t.id.trim()) {
          errors.push(`Copla #${n}: territorio #${i + 1} non ten 'id' válido.`);
          return;
        }

        if (!knownTerritoryIds.has(t.id)) {
          warnings.push(`Copla #${n}: territorio descoñecido ou non cargado: ${t.id}`);
        }
      });
    }
  });

  return { errors, warnings };
}

function renderValidation(errors, warnings, total = 0) {
  const out = qs("#validation-output");
  const summary = qs("#validation-summary");

  if (!errors.length && !warnings.length) {
    summary.textContent = `${total} copla(s) revisada(s) · sen erros nin avisos`;
    out.innerHTML = `<p>JSON válido.</p>`;
    return;
  }

  const parts = [];
  if (errors.length) {
    parts.push(`<h3>Erros</h3><ul>${errors.map(e => `<li>${e}</li>`).join("")}</ul>`);
  }
  if (warnings.length) {
    parts.push(`<h3>Avisos</h3><ul>${warnings.map(w => `<li>${w}</li>`).join("")}</ul>`);
  }

  summary.textContent = `${total} copla(s) revisada(s) · ${errors.length} erro(s) · ${warnings.length} aviso(s)`;
  out.innerHTML = parts.join("");
}

function renderPreview(payload) {
  const container = qs("#preview-output");
  container.innerHTML = "";

  if (!payload?.coplas?.length) {
    container.innerHTML = `<p class="muted">Sen vista previa.</p>`;
    return;
  }

  payload.coplas.forEach((copla, index) => {
    const el = document.createElement("article");
    el.className = "copla-card";

    const tags = Array.isArray(copla.tags) && copla.tags.length
      ? copla.tags.map(tag => `<span class="tag-pill">${tag}</span>`).join("")
      : `<span class="muted">sen etiquetas</span>`;

    const territories = Array.isArray(copla.territories) && copla.territories.length
      ? copla.territories.map(t => {
          const nome = getTerritoryLabelById(t.id);
          return `<code title="${t.id}">${nome}</code>`;
        }).join(" ")
      : `<span class="muted">sen territorio</span>`;

    el.innerHTML = `
      <div class="copla-card-top">
        <strong>${makeIncipit(copla.text || "")}</strong>
      </div>
      <div class="copla-text">${nl2br(copla.text || "")}</div>
      <div class="meta-stack">
        <div class="meta-row">
          <strong>Territorios</strong>
          <span>${territories}</span>
        </div>
        <div class="meta-row">
          <strong>Etiquetas</strong>
          <span class="tag-row">${tags}</span>
        </div>
        <div class="meta-row">
          <strong>Notas</strong>
          <span>${copla.notes || '<span class="muted">sen notas</span>'}</span>
        </div>
      </div>
    `;

    container.appendChild(el);
  });
}

function rerenderAll() {
  syncTextareaFromState();
  const { errors, warnings } = validatePayload(state);
  renderValidation(errors, warnings, state.coplas.length);
  renderEditor();
  renderPreview(state);
}

function removeCopla(index) {
  state.coplas.splice(index, 1);
  rerenderAll();
}

function addTag(index, rawValue) {
  const value = normalizeText(rawValue);
  if (!value) return;
  if (!state.coplas[index].tags.includes(value)) {
    state.coplas[index].tags.push(value);
  }
  rerenderAll();
}

function removeTag(index, tag) {
  state.coplas[index].tags = state.coplas[index].tags.filter(t => t !== tag);
  rerenderAll();
}

function addTerritory(index, territoryId) {
  if (!territoryId) return;
  const exists = state.coplas[index].territories.some(t => t.id === territoryId);
  if (!exists) {
    state.coplas[index].territories.push({ id: territoryId });
  }
  rerenderAll();
}

function removeTerritory(index, territoryId) {
  state.coplas[index].territories = state.coplas[index].territories.filter(t => t.id !== territoryId);
  rerenderAll();
}

function searchTerritories(term) {
  const q = normalizeText(term);
  if (!q) return [];

  return knownTerritories.filter(t => {
    return (
      normalizeText(t.nome || "").includes(q) ||
      normalizeText(t.search || "").includes(q) ||
      String(t.cod || "").includes(q) ||
      normalizeText(t.id || "").includes(q)
    );
  }).slice(0, 12);
}

function renderTerritoryOptions(results) {
  if (!results.length) return `<option value="">Sen resultados</option>`;

  return `
    <option value="">Escoller territorio...</option>
    ${results.map(t => `
      <option value="${t.id}">
        ${t.nome} [${t.tipo}] (${t.id})
      </option>
    `).join("")}
  `;
}

function renderEditor() {
  const container = qs("#editor-output");
  container.innerHTML = "";
  updateEditorSummary();

  if (!state.coplas.length) {
    container.innerHTML = `<p class="muted">Non hai coplas cargadas no editor.</p>`;
    return;
  }

  state.coplas.forEach((copla, index) => {
    const card = document.createElement("article");
    card.className = "import-copla-card";

    const incipit = makeIncipit(copla.text || "");

    const tagsHtml = copla.tags.length
      ? copla.tags.map(tag => `
          <button type="button" class="tag-pill tag-pill-removable" data-action="remove-tag" data-index="${index}" data-tag="${tag}">
            ${tag} ×
          </button>
        `).join("")
      : `<span class="muted">Sen etiquetas</span>`;

    const territoriesHtml = copla.territories.length
      ? copla.territories.map(t => {
          const nome = getTerritoryLabelById(t.id);
          return `
            <button type="button" class="linked-item linked-item-inline" data-action="remove-territory" data-index="${index}" data-territory-id="${t.id}" title="${t.id}">
              <span class="linked-item-title">${nome}</span>
              <span class="linked-item-meta">quitar</span>
            </button>
          `;
        }).join("")
      : `<span class="muted">Sen territorios</span>`;

    card.innerHTML = `
      <details class="import-copla-details" ${index === 0 ? "open" : ""}>
        <summary class="import-copla-summary">
          <span class="import-copla-summary-title">${incipit}</span>
          <span class="import-copla-summary-meta">
            ${copla.tags.length} etiqueta(s) · ${copla.territories.length} territorio(s)
          </span>
        </summary>

        <div class="import-copla-body">
          <div class="section-head">
            <h3 class="section-title">${incipit}</h3>
            <button type="button" class="danger-btn" data-action="remove-copla" data-index="${index}">Eliminar copla</button>
          </div>

          <div class="import-form-grid">
            <div>
              <label class="toolbar-label">Texto</label>
              <textarea class="import-copla-text" data-field="text" data-index="${index}">${copla.text || ""}</textarea>
            </div>

            <div>
              <label class="toolbar-label">Notas</label>
              <textarea class="import-copla-notes" data-field="notes" data-index="${index}">${copla.notes || ""}</textarea>
            </div>
          </div>

          <div class="import-subblock">
            <label class="toolbar-label">Etiquetas</label>
            <div class="tag-row">${tagsHtml}</div>
            <div class="inline-form">
              <input type="text" placeholder="Nova etiqueta..." data-role="tag-input" data-index="${index}">
              <div></div>
              <button type="button" data-action="add-tag" data-index="${index}">Engadir etiqueta</button>
            </div>
          </div>

          <div class="import-subblock">
            <label class="toolbar-label">Territorios</label>
            <div class="linked-block linked-block-inline">${territoriesHtml}</div>
            <div class="inline-form">
              <input type="text" placeholder="Buscar territorio por nome, código ou id..." data-role="territory-search" data-index="${index}">
              <select data-role="territory-select" data-index="${index}">
                <option value="">Escribe algo para buscar...</option>
              </select>
              <button type="button" data-action="add-territory" data-index="${index}">Engadir territorio</button>
            </div>
          </div>
        </div>
      </details>
    `;

    container.appendChild(card);
  });

  bindEditorEvents();
}

function bindEditorEvents() {
  qs("#editor-output")?.querySelectorAll("[data-field='text']").forEach(el => {
    el.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.index);
      state.coplas[index].text = e.target.value;
      syncTextareaFromState();
      renderPreview(state);
      const { errors, warnings } = validatePayload(state);
      renderValidation(errors, warnings, state.coplas.length);

      const details = e.target.closest(".import-copla-details");
      const summaryTitle = details?.querySelector(".import-copla-summary-title");
      const sectionTitle = details?.querySelector(".section-title");
      const newIncipit = makeIncipit(e.target.value);

      if (summaryTitle) summaryTitle.textContent = newIncipit;
      if (sectionTitle) sectionTitle.textContent = newIncipit;
    });
  });

  qs("#editor-output")?.querySelectorAll("[data-field='notes']").forEach(el => {
    el.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.index);
      state.coplas[index].notes = e.target.value;
      syncTextareaFromState();
      renderPreview(state);
    });
  });

  qs("#editor-output")?.querySelectorAll("[data-action='remove-copla']").forEach(btn => {
    btn.addEventListener("click", () => {
      removeCopla(Number(btn.dataset.index));
    });
  });

  qs("#editor-output")?.querySelectorAll("[data-action='add-tag']").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.index);
      const input = qs(`[data-role='tag-input'][data-index='${index}']`, qs("#editor-output"));
      addTag(index, input.value);
      input.value = "";
    });
  });

  qs("#editor-output")?.querySelectorAll("[data-action='remove-tag']").forEach(btn => {
    btn.addEventListener("click", () => {
      removeTag(Number(btn.dataset.index), btn.dataset.tag);
    });
  });

  qs("#editor-output")?.querySelectorAll("[data-role='territory-search']").forEach(input => {
    input.addEventListener("input", (e) => {
      const index = Number(e.target.dataset.index);
      const select = qs(`[data-role='territory-select'][data-index='${index}']`, qs("#editor-output"));
      const results = searchTerritories(e.target.value);
      select.innerHTML = renderTerritoryOptions(results);
    });
  });

  qs("#editor-output")?.querySelectorAll("[data-action='add-territory']").forEach(btn => {
    btn.addEventListener("click", () => {
      const index = Number(btn.dataset.index);
      const select = qs(`[data-role='territory-select'][data-index='${index}']`, qs("#editor-output"));
      addTerritory(index, select.value);
    });
  });

  qs("#editor-output")?.querySelectorAll("[data-action='remove-territory']").forEach(btn => {
    btn.addEventListener("click", () => {
      removeTerritory(Number(btn.dataset.index), btn.dataset.territoryId);
    });
  });
}

function loadPayloadFromTextarea() {
  const input = qs("#json-input");
  const payload = JSON.parse(input.value);

  if (!payload || typeof payload !== "object" || !Array.isArray(payload.coplas)) {
    throw new Error("A raíz debe conter unha lista 'coplas'.");
  }

  state = cloneState(payload);
  state.coplas = state.coplas.map(c => ({
    text: typeof c.text === "string" ? c.text : "",
    notes: typeof c.notes === "string" ? c.notes : "",
    tags: Array.isArray(c.tags) ? c.tags.filter(x => typeof x === "string") : [],
    territories: Array.isArray(c.territories)
      ? c.territories.filter(t => t && typeof t.id === "string").map(t => ({ id: t.id }))
      : []
  }));

  rerenderAll();
}

async function init() {
  mountTopNav("coplas");
  mountBreadcrumb([
    { href: "../index.html", label: "Inicio" },
    { href: "./coplas.html", label: "Coplas" },
    { label: "Importar" }
  ]);

  try {
    const territorios = await getTerritorios();
    knownTerritories = territorios;
    knownTerritoryIds = new Set(territorios.map(t => t.id));
    territoryMapById = new Map(territorios.map(t => [t.id, t]));
  } catch {
    knownTerritories = [];
    knownTerritoryIds = new Set();
    territoryMapById = new Map();
  }

  const input = qs("#json-input");
  const validateBtn = qs("#validate-btn");
  const formatBtn = qs("#format-btn");
  const clearBtn = qs("#clear-btn");
  const addEmptyBtn = qs("#add-empty-copla-btn");

  validateBtn?.addEventListener("click", () => {
    try {
      loadPayloadFromTextarea();
    } catch (err) {
      renderValidation([`JSON inválido: ${err.message}`], [], 0);
      qs("#editor-output").innerHTML = "";
      renderPreview(null);
    }
  });

  formatBtn?.addEventListener("click", () => {
    try {
      const payload = JSON.parse(input.value);
      input.value = JSON.stringify(payload, null, 2);
    } catch (err) {
      renderValidation([`JSON inválido: ${err.message}`], [], 0);
    }
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    state = { coplas: [] };
    qs("#validation-summary").textContent = "";
    qs("#validation-output").innerHTML = "";
    qs("#preview-output").innerHTML = "";
    qs("#editor-output").innerHTML = "";
    qs("#editor-summary").textContent = "";
  });

  addEmptyBtn?.addEventListener("click", () => {
    if (!Array.isArray(state.coplas)) state.coplas = [];
    state.coplas.push(emptyCopla());
    rerenderAll();
  });
}

init();