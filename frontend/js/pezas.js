import { getParam, qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";
import { getPezas, getTerritorios } from "./api.js";
import {
  addSection,
  buildPieceImportPayload,
  clearDraft,
  countDraftCoplas,
  downloadPrintablePiece,
  loadDraft,
  moveCoplaInDraft,
  moveCoplaToSection,
  openPrintablePiece,
  removeCoplaFromDraft,
  removeSection,
  RHYTHM_OPTIONS,
  updateSection,
  updateDraftMeta,
} from "./piece_builder.js";

function normalize(value = "") {
  return String(value).toLowerCase();
}

function matches(item, query) {
  if (!query) return true;
  const parts = [
    item.title,
    item.author,
    item.description,
    item.context_territory?.nome,
    item.context_territory?.id,
  ]
    .filter(Boolean)
    .map(normalize)
    .join(" ");
  return parts.includes(query);
}

function render(items) {
  const container = qs("#piece-list");
  const counter = qs("#results-count");
  container.innerHTML = "";
  counter.textContent = `${items.length} resultado${items.length === 1 ? "" : "s"}`;

  if (!items.length) {
    container.innerHTML = `<p class="muted">Non hai pezas que coincidan coa busca actual.</p>`;
    return;
  }

  for (const item of items) {
    const node = document.createElement("a");
    node.className = "linked-item";
    node.href = `./peza.html?id=${encodeURIComponent(item.id)}`;
    node.innerHTML = `
      <span class="linked-item-title">${item.title}</span>
      <span class="linked-item-meta">
        ${item.author || "sen autoría"} · ${item.copla_count} copla${item.copla_count === 1 ? "" : "s"}
        ${item.context_territory?.nome ? ` · ${item.context_territory.nome}` : ""}
      </span>
    `;
    container.appendChild(node);
  }
}

function territoryNameById(all, territoryId) {
  return all.find(item => item.id === territoryId)?.nome || "";
}

function downloadPieceJson() {
  const payload = buildPieceImportPayload();
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${payload.pieces[0].slug || "peza"}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderDraft(territorios) {
  const draft = loadDraft();
  const titleInput = qs("#piece-title");
  const authorInput = qs("#piece-author");
  const contextInput = qs("#piece-context");
  const descriptionInput = qs("#piece-description");
  const notesInput = qs("#piece-notes");
  const draftList = qs("#draft-list");
  const draftCount = qs("#draft-count");
  const contextLink = qs("#piece-context-link");
  const sectionSelectHtml = RHYTHM_OPTIONS.map(option => `<option value="${option}">${option}</option>`).join("");

  if (titleInput && titleInput.value !== draft.title) titleInput.value = draft.title || "";
  if (authorInput && authorInput.value !== draft.author) authorInput.value = draft.author || "";
  if (descriptionInput && descriptionInput.value !== draft.description) descriptionInput.value = draft.description || "";
  if (notesInput && notesInput.value !== draft.notes) notesInput.value = draft.notes || "";
  if (contextInput) contextInput.value = territoryNameById(territorios, draft.context_territory_id) || "Sen territorio principal";
  if (contextLink) {
    contextLink.href = draft.context_territory_id
      ? `./coplas.html?territory_id=${encodeURIComponent(draft.context_territory_id)}`
      : "./mapa.html";
    contextLink.textContent = draft.context_territory_id ? "Seguir engadindo desde o territorio" : "Buscar máis coplas no mapa";
  }

  const totalCoplas = countDraftCoplas(draft);
  draftCount.textContent = `${totalCoplas} copla${totalCoplas === 1 ? "" : "s"} na montaxe`;
  draftList.innerHTML = "";

  if (!totalCoplas) {
    draftList.innerHTML = `<p class="muted">A peza actual está baleira. Engade coplas desde o mapa ou desde unha ficha territorial.</p>`;
  }

  draftList.innerHTML += draft.sections.map(section => `
    <section class="piece-section" data-section-id="${section.id}">
      <div class="piece-section-head">
        <div>
          <label class="toolbar-label" for="section-label-${section.id}">Ritmo / parte</label>
          <select id="section-label-${section.id}" data-action="section-label" data-section-id="${section.id}">
            ${sectionSelectHtml}
          </select>
        </div>
        <div class="piece-builder-actions">
          <button type="button" data-action="remove-section" data-section-id="${section.id}">Quitar parte</button>
        </div>
      </div>
      <div class="linked-block">
        ${section.coplas.length ? section.coplas.map(item => `
          <div class="linked-item">
            <span class="linked-item-title">${item.incipit || "(sen incipit)"}</span>
            <span class="linked-item-meta">#${item.id}</span>
            <label class="toolbar-label" for="move-section-${section.id}-${item.id}">Mover a outra parte</label>
            <select id="move-section-${section.id}-${item.id}" data-action="move-section" data-copla-id="${item.id}">
              ${draft.sections.map(target => `<option value="${target.id}" ${target.id === section.id ? "selected" : ""}>${target.label}</option>`).join("")}
            </select>
            <div class="piece-builder-actions">
              <button type="button" data-action="move-up" data-section-id="${section.id}" data-copla-id="${item.id}">Subir</button>
              <button type="button" data-action="move-down" data-section-id="${section.id}" data-copla-id="${item.id}">Baixar</button>
              <button type="button" data-action="remove" data-copla-id="${item.id}">Quitar</button>
            </div>
          </div>
        `).join("") : `<p class="muted">Sen coplas nesta parte.</p>`}
      </div>
    </section>
  `).join("");

  draft.sections.forEach(section => {
    const labelSelect = draftList.querySelector(`[data-action="section-label"][data-section-id="${section.id}"]`);
    if (labelSelect) labelSelect.value = section.label;
  });

  if (titleInput && !titleInput.dataset.bound) {
    titleInput.dataset.bound = "true";
    titleInput.addEventListener("input", () => updateDraftMeta({ title: titleInput.value }));
  }
  if (authorInput && !authorInput.dataset.bound) {
    authorInput.dataset.bound = "true";
    authorInput.addEventListener("input", () => updateDraftMeta({ author: authorInput.value }));
  }
  if (descriptionInput && !descriptionInput.dataset.bound) {
    descriptionInput.dataset.bound = "true";
    descriptionInput.addEventListener("input", () => updateDraftMeta({ description: descriptionInput.value }));
  }
  if (notesInput && !notesInput.dataset.bound) {
    notesInput.dataset.bound = "true";
    notesInput.addEventListener("input", () => updateDraftMeta({ notes: notesInput.value }));
  }

  const downloadBtn = qs("#piece-download-btn");
  if (downloadBtn && !downloadBtn.dataset.bound) {
    downloadBtn.dataset.bound = "true";
    downloadBtn.addEventListener("click", downloadPieceJson);
  }

  const clearBtn = qs("#piece-clear-btn");
  if (clearBtn && !clearBtn.dataset.bound) {
    clearBtn.dataset.bound = "true";
    clearBtn.addEventListener("click", () => {
      clearDraft();
      renderDraft(territorios);
    });
  }

  const addSectionBtn = qs("#piece-add-section-btn");
  if (addSectionBtn && !addSectionBtn.dataset.bound) {
    addSectionBtn.dataset.bound = "true";
    addSectionBtn.addEventListener("click", () => {
      addSection("xota");
      renderDraft(territorios);
    });
  }

  const printBtn = qs("#piece-print-btn");
  if (printBtn && !printBtn.dataset.bound) {
    printBtn.dataset.bound = "true";
    printBtn.addEventListener("click", () => openPrintablePiece(territorios));
  }

  const htmlBtn = qs("#piece-html-btn");
  if (htmlBtn && !htmlBtn.dataset.bound) {
    htmlBtn.dataset.bound = "true";
    htmlBtn.addEventListener("click", () => downloadPrintablePiece(territorios));
  }

  draftList.querySelectorAll("[data-action='section-label']").forEach(select => {
    select.addEventListener("change", () => {
      updateSection(select.dataset.sectionId, { label: select.value });
      renderDraft(territorios);
    });
  });

  draftList.querySelectorAll("[data-action='move-section']").forEach(select => {
    select.addEventListener("change", () => {
      moveCoplaToSection(Number(select.dataset.coplaId), select.value);
      renderDraft(territorios);
    });
  });

  draftList.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      const coplaId = Number(button.dataset.coplaId);
      if (action === "remove") removeCoplaFromDraft(coplaId);
      if (action === "remove-section") removeSection(button.dataset.sectionId);
      if (action === "move-up") moveCoplaInDraft(coplaId, "up", button.dataset.sectionId);
      if (action === "move-down") moveCoplaInDraft(coplaId, "down", button.dataset.sectionId);
      renderDraft(territorios);
    });
  });
}

async function init() {
  try {
    mountTopNav("pezas");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { label: "Pezas" },
    ]);

    const [items, territorios] = await Promise.all([getPezas(), getTerritorios()]);
    const territoryId = getParam("territory_id");
    if (territoryId) {
      updateDraftMeta({ context_territory_id: territoryId });
    }
    const search = qs("#search");

    function update() {
      const query = normalize(search?.value || "").trim();
      render(items.filter(item => matches(item, query)));
    }

    search?.addEventListener("input", update);
    renderDraft(territorios);
    update();
  } catch (err) {
    qs("#piece-list").innerHTML = `<p class="muted">${err.message}</p>`;
  }
}

init();
