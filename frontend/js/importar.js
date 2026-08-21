import { getCoplas, getTerritorios } from "./api.js";
import { nl2br, normalizeText, qs } from "./utils.js";
import { mountBreadcrumb, mountTopNav } from "./nav.js";

let knownTerritories = [];
let territoryMapById = new Map();
let existingCoplas = [];
let batch = [];

function emptyCopla() {
  return {
    id: null,
    text: "",
    notes: "",
    tags: [],
    territories: [],
    versions: [],
    status: "published",
    territory_state: "assigned",
  };
}

function makeIncipit(text = "", maxWords = 6) {
  const words = String(text).trim().split(/\s+/).filter(Boolean);
  return words.length ? words.slice(0, maxWords).join(" ") : "(sen texto)";
}

function getFormState() {
  const idValue = qs("#copla-id")?.value.trim();
  const tags = (qs("#copla-tags")?.value || "")
    .split(",")
    .map(item => normalizeText(item))
    .filter(Boolean);

  const territories = Array.from(qs("#selected-territories")?.querySelectorAll("[data-territory-id]") || [])
    .map(node => ({ id: node.dataset.territoryId }));
  const versions = Array.from(qs("#version-list")?.querySelectorAll("[data-version-index]") || [])
    .map(node => ({
      label: node.dataset.versionLabel || "",
      text: node.dataset.versionText || "",
      notes: node.dataset.versionNotes || "",
    }));

  return {
    id: idValue ? Number(idValue) : null,
    text: qs("#copla-text")?.value || "",
    notes: qs("#copla-notes")?.value || "",
    status: qs("#copla-status")?.value || "published",
    territory_state: qs("#copla-territory-state")?.value || "assigned",
    tags,
    territories,
    versions,
  };
}

function setFormState(copla) {
  const next = { ...emptyCopla(), ...copla };
  qs("#copla-id").value = next.id ?? "";
  qs("#copla-text").value = next.text || "";
  qs("#copla-notes").value = next.notes || "";
  qs("#copla-status").value = next.status || "published";
  qs("#copla-territory-state").value = next.territory_state || "assigned";
  qs("#copla-tags").value = (next.tags || []).join(", ");
  renderSelectedTerritories(next.territories || []);
  renderVersions(next.versions || []);
  updateFormMeta(next);
}

function updateFormMeta(copla = getFormState()) {
  const meta = qs("#copla-form-meta");
  if (!meta) return;

  const mode = copla.id ? `Edición de #${copla.id}` : "Alta nova";
  const territoryCount = (copla.territories || []).length;
  meta.textContent = `${mode} · ${territoryCount} territorio(s) · ${copla.territory_state || "assigned"} · status ${copla.status || "published"}`;
}

function resetForm() {
  setFormState(emptyCopla());
}

function renderVersions(versions) {
  const container = qs("#version-list");
  const counter = qs("#version-count");
  if (!container) return;

  if (counter) {
    counter.textContent = `${versions.length} versión${versions.length === 1 ? "" : "s"}`;
  }

  container.innerHTML = "";
  if (!versions.length) {
    container.innerHTML = `<p class="muted">Sen variantes rexistradas. O texto principal funciona como versión canónica.</p>`;
    return;
  }

  versions.forEach((version, index) => {
    const node = document.createElement("button");
    node.type = "button";
    node.className = "linked-item linked-item-button";
    node.dataset.versionIndex = String(index);
    node.dataset.versionLabel = version.label || "";
    node.dataset.versionText = version.text || "";
    node.dataset.versionNotes = version.notes || "";
    node.innerHTML = `
      <span class="linked-item-title">${version.label || `Versión ${index + 1}`}</span>
      <span class="linked-item-meta">${makeIncipit(version.text)} · preme para quitar</span>
    `;
    node.addEventListener("click", () => {
      const current = getFormState();
      current.versions = current.versions.filter((_item, itemIndex) => itemIndex !== index);
      renderVersions(current.versions);
      updateFormMeta(current);
    });
    container.appendChild(node);
  });
}

function addVersionFromForm() {
  const text = qs("#version-text")?.value || "";
  if (!text.trim()) {
    qs("#admin-feedback").textContent = "A versión precisa texto antes de engadila.";
    return;
  }
  const current = getFormState();
  current.versions.push({
    label: qs("#version-label")?.value || "",
    text,
    notes: qs("#version-notes")?.value || "",
  });
  renderVersions(current.versions);
  qs("#version-label").value = "";
  qs("#version-text").value = "";
  qs("#version-notes").value = "";
  updateFormMeta(current);
}

function renderSelectedTerritories(territories) {
  const container = qs("#selected-territories");
  container.innerHTML = "";

  if (!territories.length) {
    const territoryState = qs("#copla-territory-state")?.value || "assigned";
    const message = territoryState === "general"
      ? "Sen territorios: esta copla quedará como xeral."
      : territoryState === "unassigned"
        ? "Sen territorios: esta copla quedará como non adscrita / territorio descoñecido."
        : "Esta copla precisa polo menos un territorio para quedar asignada.";
    container.innerHTML = `<span class="muted">${message}</span>`;
    return;
  }

  for (const item of territories) {
    const territory = territoryMapById.get(item.id);
    const button = document.createElement("button");
    button.type = "button";
    button.className = "linked-item linked-item-inline";
    button.dataset.territoryId = item.id;
    button.innerHTML = `
      <span class="linked-item-title">${territory?.nome || item.id}</span>
      <span class="linked-item-meta">quitar</span>
    `;
    button.addEventListener("click", () => {
      const current = getFormState();
      current.territories = current.territories.filter(entry => entry.id !== item.id);
      renderSelectedTerritories(current.territories);
      updateFormMeta(current);
    });
    container.appendChild(button);
  }
}

function renderTerritorySearch(term) {
  const select = qs("#territory-select");
  const q = normalizeText(term);
  if (!q) {
    select.innerHTML = `<option value="">Escribe algo para buscar...</option>`;
    return;
  }

  const results = knownTerritories.filter(item =>
    normalizeText(item.nome || "").includes(q) ||
    normalizeText(item.search || "").includes(q) ||
    normalizeText(item.id || "").includes(q) ||
    String(item.cod || "").includes(q)
  ).slice(0, 16);

  if (!results.length) {
    select.innerHTML = `<option value="">Sen resultados</option>`;
    return;
  }

  select.innerHTML = `
    <option value="">Escoller territorio...</option>
    ${results.map(item => `<option value="${item.id}">${item.nome} [${item.tipo}] (${item.id})</option>`).join("")}
  `;
}

function addSelectedTerritory() {
  const select = qs("#territory-select");
  const territoryId = select?.value;
  if (!territoryId) return;

  const current = getFormState();
  if (!current.territories.some(item => item.id === territoryId)) {
    current.territories.push({ id: territoryId });
  }
  renderSelectedTerritories(current.territories);
  updateFormMeta(current);
}

function upsertBatchCopla(copla) {
  const normalized = {
    id: Number.isInteger(copla.id) ? copla.id : null,
    text: String(copla.text || "").trim(),
    notes: String(copla.notes || ""),
    status: copla.status || "published",
    territory_state: copla.territory_state || "assigned",
    tags: Array.isArray(copla.tags) ? copla.tags : [],
    territories: Array.isArray(copla.territories) ? copla.territories : [],
    versions: Array.isArray(copla.versions) ? copla.versions : [],
  };

  const existingIndex = batch.findIndex(item => {
    if (normalized.id && item.id) return Number(item.id) === Number(normalized.id);
    return item.text === normalized.text && normalized.text.length > 0;
  });

  if (existingIndex >= 0) {
    batch[existingIndex] = normalized;
  } else {
    batch.unshift(normalized);
  }
}

function renderBatch() {
  const container = qs("#batch-list");
  const summary = qs("#batch-summary");
  const jsonOutput = qs("#batch-json-output");

  summary.textContent = `${batch.length} copla(s) preparadas para importar ou actualizar`;
  container.innerHTML = "";

  if (!batch.length) {
    container.innerHTML = `<p class="muted">O lote está baleiro. Engade unha copla desde o formulario ou carga o corpus actual para editalo.</p>`;
    jsonOutput.textContent = '{\n  "coplas": []\n}';
    return;
  }

  for (const item of batch) {
    const card = document.createElement("article");
    card.className = "copla-card";

    const territoryNames = (item.territories || []).length
      ? item.territories.map(entry => territoryMapById.get(entry.id)?.nome || entry.id).join(", ")
      : item.territory_state === "general"
        ? "copla xeral"
        : "non adscrita / territorio descoñecido";

    card.innerHTML = `
      <div class="copla-card-top">
        <strong>${makeIncipit(item.text)}</strong>
        <span class="copla-id">${item.id ? `#${item.id}` : "nova"}</span>
      </div>
      <div class="copla-text">${nl2br(item.text)}</div>
      <div class="meta-stack">
        <div class="meta-row"><strong>Status</strong><span>${item.status}</span></div>
        <div class="meta-row"><strong>Tipo territorial</strong><span>${item.territory_state || "assigned"}</span></div>
        <div class="meta-row"><strong>Territorios</strong><span>${territoryNames}</span></div>
        <div class="meta-row"><strong>Etiquetas</strong><span>${(item.tags || []).join(", ") || "sen etiquetas"}</span></div>
        <div class="meta-row"><strong>Versións</strong><span>${(item.versions || []).length}</span></div>
      </div>
      <div class="toolbar-actions">
        <button type="button" data-action="edit" data-id="${item.id ?? ""}" data-text="${encodeURIComponent(item.text)}">Editar</button>
        <button type="button" class="danger-btn" data-action="remove">Quitar do lote</button>
      </div>
    `;

    card.querySelector("[data-action='edit']")?.addEventListener("click", () => {
      setFormState(item);
      window.scrollTo({ top: 0, behavior: "smooth" });
    });

    card.querySelector("[data-action='remove']")?.addEventListener("click", () => {
      batch = batch.filter(entry => entry !== item);
      renderBatch();
    });

    container.appendChild(card);
  }

  jsonOutput.textContent = `${JSON.stringify({ coplas: batch }, null, 2)}\n`;
}

function populateExistingSelector() {
  const select = qs("#existing-coplas");
  select.innerHTML = `<option value="">Escoller copla publicada...</option>`;

  for (const copla of existingCoplas) {
    const option = document.createElement("option");
    option.value = String(copla.id);
    option.textContent = `#${copla.id} · ${makeIncipit(copla.text)}`;
    select.appendChild(option);
  }
}

function downloadBatchJson() {
  const blob = new Blob([`${JSON.stringify({ coplas: batch }, null, 2)}\n`], {
    type: "application/json",
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "coplas-lote.json";
  link.click();
  URL.revokeObjectURL(link.href);
}

async function init() {
  mountTopNav("admin");
  mountBreadcrumb([
    { href: "../index.html", label: "Inicio" },
    { label: "Admin local" },
  ]);

  [knownTerritories, existingCoplas] = await Promise.all([getTerritorios(), getCoplas()]);
  territoryMapById = new Map(knownTerritories.map(item => [item.id, item]));
  populateExistingSelector();
  resetForm();
  renderBatch();

  qs("#territory-search")?.addEventListener("input", event => {
    renderTerritorySearch(event.target.value);
  });

  qs("#territory-add-btn")?.addEventListener("click", addSelectedTerritory);
  qs("#version-add-btn")?.addEventListener("click", addVersionFromForm);

  qs("#copla-text")?.addEventListener("input", () => updateFormMeta());
  qs("#copla-status")?.addEventListener("change", () => updateFormMeta());
  qs("#copla-territory-state")?.addEventListener("change", () => {
    renderSelectedTerritories(getFormState().territories);
    updateFormMeta();
  });

  qs("#copla-reset-btn")?.addEventListener("click", resetForm);

  qs("#copla-add-btn")?.addEventListener("click", () => {
    const current = getFormState();
    if (!current.text.trim()) {
      qs("#admin-feedback").textContent = "Cómpre engadir texto antes de meter a copla no lote.";
      return;
    }
    if (current.territory_state === "assigned" && !current.territories.length) {
      qs("#admin-feedback").textContent = "Se a copla está asignada, cómpre indicar polo menos un territorio.";
      return;
    }
    if (current.territory_state !== "assigned" && current.territories.length) {
      qs("#admin-feedback").textContent = "As coplas xerais ou non adscritas deben ir sen territorios ligados.";
      return;
    }
    upsertBatchCopla(current);
    renderBatch();
    qs("#admin-feedback").textContent = current.id
      ? `Copla #${current.id} preparada para actualizar no lote.`
      : "Copla nova engadida ao lote.";
    resetForm();
  });

  qs("#existing-coplas")?.addEventListener("change", event => {
    const id = Number(event.target.value);
    const copla = existingCoplas.find(item => Number(item.id) === id);
    if (copla) {
      setFormState({
        id: copla.id,
        text: copla.text,
        notes: copla.notes || "",
        status: copla.status || "published",
        territory_state: copla.territory_state || "assigned",
        tags: copla.tags || [],
        territories: copla.territories?.map(item => ({ id: item.id })) || [],
        versions: copla.versions || [],
      });
      qs("#admin-feedback").textContent = `Copla #${copla.id} cargada no formulario para edición.`;
    }
  });

  qs("#load-current-batch-btn")?.addEventListener("click", () => {
    batch = existingCoplas.map(item => ({
      id: item.id,
      text: item.text,
      notes: item.notes || "",
      status: item.status || "published",
      territory_state: item.territory_state || "assigned",
      tags: item.tags || [],
      territories: item.territories?.map(entry => ({ id: entry.id })) || [],
      versions: item.versions || [],
    }));
    renderBatch();
    qs("#admin-feedback").textContent = "Corpus actual cargado no lote para revisión local.";
  });

  qs("#download-batch-btn")?.addEventListener("click", downloadBatchJson);
}

init().catch(err => {
  const feedback = qs("#admin-feedback");
  if (feedback) feedback.textContent = err.message;
});
