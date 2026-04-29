import { getTerritorios, getCoplas, getGeoLayer, getPezas, getMedia } from "./api.js";
import { getParam, nl2br, qs, territoryLabel } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";
import {
  addCoplaToDraft,
  buildPieceImportPayload,
  clearDraft,
  draftHasCopla,
  ensureContextTerritory,
  loadDraft,
  moveCoplaInDraft,
  removeCoplaFromDraft,
  updateDraftMeta,
} from "./piece_builder.js";

const TYPE_LABELS = {
  prov: "Provincia",
  com: "Comarca",
  con: "Concello",
  par: "Parroquia",
};

let territoryMap;
let territoryLayer;

function buildHierarchy(territorio, all) {
  if (!territorio) return [];

  const out = [];
  const prov = territorio.prov ? all.find(t => t.tipo === "prov" && t.cod === territorio.prov) : null;
  const com = territorio.com ? all.find(t => t.tipo === "com" && t.cod === territorio.com) : null;
  const con = territorio.con ? all.find(t => t.tipo === "con" && t.cod === territorio.con) : null;

  if (prov) out.push(prov);
  if (com) out.push(com);
  if (con) out.push(con);
  if (!out.find(x => x.id === territorio.id)) out.push(territorio);

  return out;
}

function getChildren(territorio, all) {
  if (!territorio) return [];

  if (territorio.tipo === "prov") {
    return all.filter(t => t.tipo === "com" && t.prov === territorio.cod);
  }

  if (territorio.tipo === "com") {
    return all.filter(t => t.tipo === "con" && t.com === territorio.cod);
  }

  if (territorio.tipo === "con") {
    return all.filter(t => t.tipo === "par" && t.con === territorio.cod);
  }

  return [];
}

function getDescendantIds(territorio, all) {
  if (!territorio) return [];
  const ids = new Set([territorio.id]);

  if (territorio.tipo === "prov") {
    all.filter(t => t.tipo === "com" && t.prov === territorio.cod).forEach(t => ids.add(t.id));
    all.filter(t => t.tipo === "con" && t.prov === territorio.cod).forEach(t => ids.add(t.id));
    all.filter(t => t.tipo === "par" && t.prov === territorio.cod).forEach(t => ids.add(t.id));
  }

  if (territorio.tipo === "com") {
    all.filter(t => t.tipo === "con" && t.com === territorio.cod).forEach(t => ids.add(t.id));
    all.filter(t => t.tipo === "par" && t.com === territorio.cod).forEach(t => ids.add(t.id));
  }

  if (territorio.tipo === "con") {
    all.filter(t => t.tipo === "par" && t.con === territorio.cod).forEach(t => ids.add(t.id));
  }

  return Array.from(ids);
}

function filterCoplasByTerritory(coplas, territoryIds) {
  const ids = new Set(territoryIds);
  return coplas.filter(copla =>
    (copla.territories || []).some(t => ids.has(t.id))
  );
}

function filterPiecesByTerritory(pieces, territoryIds, coplas) {
  const ids = new Set(territoryIds);
  const relatedCoplaIds = new Set(coplas.map(item => item.id));

  return pieces.filter(piece => {
    if (piece.context_territory?.id && ids.has(piece.context_territory.id)) {
      return true;
    }

    return (piece.coplas || []).some(item => relatedCoplaIds.has(item.id));
  });
}

function filterMediaByContext(mediaItems, territoryIds, coplas, pieces) {
  const ids = new Set(territoryIds);
  const coplaIds = new Set(coplas.map(item => String(item.id)));
  const pieceIds = new Set(pieces.map(item => String(item.id)));

  return mediaItems.filter(item =>
    (item.links || []).some(link => {
      if (link.entity_type === "territory") return ids.has(link.entity_id);
      if (link.entity_type === "copla") return coplaIds.has(String(link.entity_id));
      if (link.entity_type === "piece") return pieceIds.has(String(link.entity_id));
      return false;
    })
  );
}

function renderTerritoryInfo(territorio, hierarchy, children) {
  qs("#title").textContent = territorio.nome;
  qs("#subtitle").textContent = TYPE_LABELS[territorio.tipo] || territorio.tipo;

  const meta = qs("#meta");
  meta.innerHTML = `
    <div class="meta-row"><strong>Tipo</strong><span>${TYPE_LABELS[territorio.tipo] || territorio.tipo}</span></div>
    <div class="meta-row"><strong>ID</strong><code>${territorio.id}</code></div>
    <div class="meta-row"><strong>Código</strong><span>${territorio.cod}</span></div>
    <div class="meta-row"><strong>Slug</strong><span>${territorio.slug || "—"}</span></div>
  `;

  const h = qs("#hierarchy");
  h.innerHTML = "";
  for (const item of hierarchy) {
    const li = document.createElement("li");
    li.className = "compact-item";
    li.innerHTML = `<a href="./territorio.html?id=${encodeURIComponent(item.id)}">${territoryLabel(item)}</a>`;
    h.appendChild(li);
  }

  const c = qs("#children");
  c.innerHTML = "";

  if (!children.length) {
    c.innerHTML = `<li class="compact-item muted">Este territorio non ten subterritorios rexistrados neste nivel.</li>`;
    return;
  }

  for (const item of children.sort((a, b) => a.nome.localeCompare(b.nome, "gl"))) {
    const li = document.createElement("li");
    li.className = "compact-item";
    li.innerHTML = `<a href="./territorio.html?id=${encodeURIComponent(item.id)}">${territoryLabel(item)}</a>`;
    c.appendChild(li);
  }
}

function renderCoplas(coplas) {
  const ul = qs("#copla-list");
  const counter = qs("#copla-count");
  ul.innerHTML = "";

  counter.textContent = `${coplas.length} copla${coplas.length === 1 ? "" : "s"}`;

  if (!coplas.length) {
    ul.innerHTML = `<li class="list-item muted">Non hai coplas vinculadas a este territorio.</li>`;
    return;
  }

  for (const item of coplas) {
    const territories = (item.territories || []).map(t => t.nome).join(", ") || "sen territorio";
    const tags = (item.tags || []).join(", ") || "sen etiquetas";
    const isSelected = draftHasCopla(item.id);

    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <a href="./copla.html?id=${encodeURIComponent(item.id)}">
        <strong>${item.incipit || "(sen incipit)"}</strong>
      </a>
      <div class="copla-text">${nl2br(item.text)}</div>
      <div class="meta-stack">
        <div class="meta-row"><strong>Territorios</strong><span>${territories}</span></div>
        <div class="meta-row"><strong>Etiquetas</strong><span>${tags}</span></div>
      </div>
      <div class="toolbar-actions">
        <button
          type="button"
          class="piece-action-btn"
          data-action="${isSelected ? "remove" : "add"}"
          data-copla-id="${item.id}"
        >
          ${isSelected ? "Quitar da peza" : "Engadir á peza"}
        </button>
      </div>
    `;
    ul.appendChild(li);
  }
}

function territoryNameById(all, territoryId) {
  return all.find(item => item.id === territoryId)?.nome || territoryId || "";
}

function downloadPieceJson() {
  const payload = buildPieceImportPayload();
  const content = JSON.stringify(payload, null, 2);
  const blob = new Blob([`${content}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const slug = payload.pieces[0].slug || "peza";
  link.href = url;
  link.download = `${slug}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function renderDraftBuilder(territorio, territorios, relatedCoplas) {
  const draft = ensureContextTerritory(territorio.id);
  const list = qs("#draft-list");
  const count = qs("#draft-count");
  const titleInput = qs("#piece-title");
  const authorInput = qs("#piece-author");
  const contextInput = qs("#piece-context");
  const descriptionInput = qs("#piece-description");
  const notesInput = qs("#piece-notes");

  if (titleInput && titleInput.value !== draft.title) titleInput.value = draft.title || "";
  if (authorInput && authorInput.value !== draft.author) authorInput.value = draft.author || "";
  if (descriptionInput && descriptionInput.value !== draft.description) {
    descriptionInput.value = draft.description || "";
  }
  if (notesInput && notesInput.value !== draft.notes) notesInput.value = draft.notes || "";
  if (contextInput) {
    contextInput.value = territoryNameById(territorios, draft.context_territory_id);
  }

  list.innerHTML = "";
  count.textContent = `${draft.coplas.length} copla${draft.coplas.length === 1 ? "" : "s"} seleccionada${draft.coplas.length === 1 ? "" : "s"}`;

  if (!draft.coplas.length) {
    list.innerHTML = `<p class="muted">Aínda non hai coplas nesta peza. Engádeas desde a listaxe superior.</p>`;
  } else {
    for (const item of draft.coplas) {
      const territoryNames = relatedCoplas
        .find(copla => Number(copla.id) === Number(item.id))
        ?.territories?.map(entry => entry.nome)
        ?.join(", ");

      const node = document.createElement("div");
      node.className = "linked-item";
      node.innerHTML = `
        <span class="linked-item-title">${item.incipit || "(sen incipit)"}</span>
        <span class="linked-item-meta">#${item.id}${territoryNames ? ` · ${territoryNames}` : ""}</span>
        <div class="piece-builder-actions">
          <button type="button" data-action="move-up" data-copla-id="${item.id}">Subir</button>
          <button type="button" data-action="move-down" data-copla-id="${item.id}">Baixar</button>
          <button type="button" data-action="remove" data-copla-id="${item.id}">Quitar</button>
        </div>
      `;
      list.appendChild(node);
    }
  }

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

  const downloadButton = qs("#piece-download-btn");
  if (downloadButton && !downloadButton.dataset.bound) {
    downloadButton.dataset.bound = "true";
    downloadButton.addEventListener("click", downloadPieceJson);
  }

  const clearButton = qs("#piece-clear-btn");
  if (clearButton && !clearButton.dataset.bound) {
    clearButton.dataset.bound = "true";
    clearButton.addEventListener("click", () => {
      clearDraft();
      ensureContextTerritory(territorio.id);
      renderCoplas(relatedCoplas);
      renderDraftBuilder(territorio, territorios, relatedCoplas);
    });
  }

  list.querySelectorAll("button[data-action]").forEach(button => {
    button.addEventListener("click", () => {
      const action = button.dataset.action;
      const coplaId = Number(button.dataset.coplaId);
      if (action === "remove") removeCoplaFromDraft(coplaId);
      if (action === "move-up") moveCoplaInDraft(coplaId, "up");
      if (action === "move-down") moveCoplaInDraft(coplaId, "down");
      renderCoplas(relatedCoplas);
      renderDraftBuilder(territorio, territorios, relatedCoplas);
    });
  });

  qs("#copla-list")?.querySelectorAll(".piece-action-btn").forEach(button => {
    button.addEventListener("click", () => {
      const coplaId = Number(button.dataset.coplaId);
      const copla = relatedCoplas.find(item => Number(item.id) === coplaId);
      if (!copla) return;

      if (button.dataset.action === "remove") {
        removeCoplaFromDraft(coplaId);
      } else {
        addCoplaToDraft(copla);
      }

      renderCoplas(relatedCoplas);
      renderDraftBuilder(territorio, territorios, relatedCoplas);
    });
  });
}

function renderPieces(pieces) {
  const container = qs("#piece-list");
  const counter = qs("#piece-count");
  container.innerHTML = "";
  counter.textContent = `${pieces.length} peza${pieces.length === 1 ? "" : "s"}`;

  if (!pieces.length) {
    container.innerHTML = `<p class="muted">Non hai pezas relacionadas con este territorio.</p>`;
    return;
  }

  for (const item of pieces) {
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

function renderMedia(mediaItems) {
  const container = qs("#media-list");
  const counter = qs("#media-count");
  container.innerHTML = "";
  counter.textContent = `${mediaItems.length} recurso${mediaItems.length === 1 ? "" : "s"}`;

  if (!mediaItems.length) {
    container.innerHTML = `<p class="muted">Non hai media relacionada con este territorio.</p>`;
    return;
  }

  for (const item of mediaItems) {
    const links = (item.links || [])
      .map(link => `${link.entity_type}:${link.entity_id}`)
      .join(" · ");

    const node = document.createElement("a");
    node.className = "linked-item";
    node.href = item.url;
    node.target = "_blank";
    node.rel = "noreferrer";
    node.innerHTML = `
      <span class="linked-item-title">${item.title}</span>
      <span class="linked-item-meta">${item.provider} · ${item.media_kind}${links ? ` · ${links}` : ""}</span>
    `;
    container.appendChild(node);
  }
}

function topoToGeo(topo) {
  if (!window.topojson) return topo;
  const objectName = Object.keys(topo.objects || {})[0];
  return window.topojson.feature(topo, topo.objects[objectName]);
}

function getFeatureCod(feature, tipo) {
  const p = feature?.properties || {};

  if (tipo === "prov") return Number(p.CODPROV ?? p.cod ?? p.CODIGO ?? p.COD);
  if (tipo === "com") return Number(p.CODCOM ?? p.cod ?? p.CODIGO ?? p.COD);
  if (tipo === "con") return Number(p.CODCONC ?? p.cod ?? p.CODIGO ?? p.COD);
  if (tipo === "par") return Number(p.CODPARRO ?? p.CODPARR ?? p.cod ?? p.CODIGO ?? p.COD);

  return null;
}

function getFeatureNome(feature, tipo) {
  const p = feature?.properties || {};

  if (tipo === "prov") return p.PROVINCIA || p.NOME || p.nome || p.NAME || "Territorio";
  if (tipo === "com") return p.COMARCA || p.NOME || p.nome || p.NAME || "Territorio";
  if (tipo === "con") return p.CONCELLO || p.NOME || p.nome || p.NAME || "Territorio";
  if (tipo === "par") return p.PARROQUIA || p.NOME || p.nome || p.NAME || "Territorio";

  return p.NOME || p.nome || p.NAME || "Territorio";
}

function styleBase() {
  return {
    weight: 1.2,
    opacity: 1,
    color: "#709775",
    fillColor: "#d8e6d1",
    fillOpacity: 0.22,
  };
}

function styleHighlight() {
  return {
    weight: 2.4,
    opacity: 1,
    color: "#2d6a4f",
    fillColor: "#90b494",
    fillOpacity: 0.42,
  };
}

async function renderTerritoryMap(territorio) {
  const container = qs("#territory-map");
  const note = qs("#map-note");

  if (!container || !window.L) {
    if (note) note.textContent = "Non se puido inicializar o mapa.";
    return;
  }

  let data = await getGeoLayer(territorio.tipo);
  if (territorio.tipo === "par" && data.type === "Topology") {
    data = topoToGeo(data);
  }

  if (!territoryMap) {
    territoryMap = L.map("territory-map", {
      zoomControl: true,
      attributionControl: true,
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(territoryMap);
  }

  if (territoryLayer) {
    territoryLayer.remove();
  }

  let matchedLayer = null;

  territoryLayer = L.geoJSON(data, {
    style: styleBase,
    onEachFeature(feature, layer) {
      const cod = getFeatureCod(feature, territorio.tipo);
      const nome = getFeatureNome(feature, territorio.tipo);

      if (Number(cod) === Number(territorio.cod)) {
        matchedLayer = layer;
        layer.setStyle(styleHighlight());
        layer.bindPopup(`<strong>${territorio.nome}</strong><br><span class="muted">${territorio.id}</span>`);
      } else {
        layer.bindTooltip(nome, { sticky: true, direction: "auto" });
      }
    },
  }).addTo(territoryMap);

  if (matchedLayer) {
    try {
      territoryMap.fitBounds(matchedLayer.getBounds(), { padding: [20, 20] });
      matchedLayer.openPopup();
      note.textContent = `Vista da capa de ${TYPE_LABELS[territorio.tipo]?.toLowerCase() || territorio.tipo}.`;
    } catch {
      note.textContent = "";
    }
  } else {
    try {
      territoryMap.fitBounds(territoryLayer.getBounds(), { padding: [20, 20] });
    } catch {}
    note.textContent = "Non se atopou a xeometría exacta deste territorio na capa correspondente.";
  }

  setTimeout(() => {
    territoryMap.invalidateSize();
  }, 50);
}

async function init() {
  try {
    const id = getParam("id");
    if (!id) {
      mountTopNav("territorios");
      mountBreadcrumb([
        { href: "../index.html", label: "Inicio" },
        { href: "./territorios.html", label: "Territorios" },
        { label: "Territorio non especificado" }
      ]);
      qs("#title").textContent = "Territorio non especificado";
      qs("#subtitle").textContent = "";
      return;
    }

    const [territorios, coplas, pieces, mediaItems] = await Promise.all([
      getTerritorios(),
      getCoplas(),
      getPezas(),
      getMedia(),
    ]);

    const territorio = territorios.find(t => t.id === id);

    if (!territorio) {
      mountTopNav("territorios");
      mountBreadcrumb([
        { href: "../index.html", label: "Inicio" },
        { href: "./territorios.html", label: "Territorios" },
        { label: "Territorio non atopado" }
      ]);
      qs("#title").textContent = "Territorio non atopado";
      qs("#subtitle").textContent = "";
      return;
    }

    mountTopNav("territorios");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { href: "./territorios.html", label: "Territorios" },
      { label: territorio.nome }
    ]);

    const hierarchy = buildHierarchy(territorio, territorios);
    const children = getChildren(territorio, territorios);
    const descendantIds = getDescendantIds(territorio, territorios);
    const relatedCoplas = filterCoplasByTerritory(coplas, descendantIds);
    const relatedPieces = filterPiecesByTerritory(pieces, descendantIds, relatedCoplas);
    const relatedMedia = filterMediaByContext(mediaItems, descendantIds, relatedCoplas, relatedPieces);

    renderTerritoryInfo(territorio, hierarchy, children);
    renderCoplas(relatedCoplas);
    renderDraftBuilder(territorio, territorios, relatedCoplas);
    renderPieces(relatedPieces);
    renderMedia(relatedMedia);
    await renderTerritoryMap(territorio);
  } catch (err) {
    mountTopNav("territorios");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { href: "./territorios.html", label: "Territorios" },
      { label: "Erro" }
    ]);
    qs("#title").textContent = err.message;
    qs("#subtitle").textContent = "";
    const note = qs("#map-note");
    if (note) note.textContent = "Erro ao cargar o mapa.";
  }
}

init();
