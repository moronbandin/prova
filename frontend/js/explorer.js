import { getCoplas, getGeoLayer, getMedia, getPezas, getTerritorios } from "./api.js";
import { escapeHtml, getParam, nl2br, normalizeText, qs, territoryLabel } from "./utils.js";
import {
  TYPE_LABELS,
  buildHierarchy,
  filterCoplasByTerritory,
  filterMediaByContext,
  filterPiecesByTerritory,
  findTerritoryByFeature,
  getChildren,
  getDescendantIds,
  getFeatureNome,
  searchTerritories,
} from "./territory_data.js";

let map;
let currentLayer;
let highlightLayer;
let territorios = [];
let coplas = [];
let pieces = [];
let mediaItems = [];
let currentLayerType = "con";
let selectedTerritory = null;
let suppressAutoLayerFit = false;
let loadSequence = 0;

function isInsidePages() {
  return window.location.pathname.includes("/pages/");
}

function pageHref(name) {
  const insidePages = isInsidePages();
  const map = {
    territory: insidePages ? "./territorio.html" : "./pages/territorio.html",
    coplas: insidePages ? "./coplas.html" : "./pages/coplas.html",
    pezas: insidePages ? "./pezas.html" : "./pages/pezas.html",
    importar: insidePages ? "./importar.html" : "./pages/importar.html",
  };
  return map[name] || name;
}

function topoToGeo(topo) {
  if (!window.topojson) return topo;
  const objectName = Object.keys(topo.objects || {})[0];
  return window.topojson.feature(topo, topo.objects[objectName]);
}

function styleForLayer(isSelected = false) {
  if (isSelected) {
    return {
      weight: 2.5,
      opacity: 1,
      color: "#f6f5ef",
      fillColor: "#f28f3b",
      fillOpacity: 0.68,
    };
  }

  return {
    weight: 1.1,
    opacity: 0.9,
    color: "#17444d",
    fillColor: "#2f7c85",
    fillOpacity: 0.26,
  };
}

function currentContext() {
  if (!selectedTerritory) {
    return {
      hierarchy: [],
      children: [],
      relatedCoplas: [],
      relatedPieces: [],
      relatedMedia: [],
    };
  }

  const descendantIds = getDescendantIds(selectedTerritory, territorios);
  const relatedCoplas = filterCoplasByTerritory(coplas, descendantIds);
  const relatedPieces = filterPiecesByTerritory(pieces, descendantIds, relatedCoplas);
  const relatedMedia = filterMediaByContext(mediaItems, descendantIds, relatedCoplas, relatedPieces);

  return {
    hierarchy: buildHierarchy(selectedTerritory, territorios),
    children: getChildren(selectedTerritory, territorios),
    relatedCoplas,
    relatedPieces,
    relatedMedia,
  };
}

function setLayerStatus(message, state = "loading") {
  const status = qs("#explorer-layer-status");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function summarizeInheritance(territory, context) {
  if (!territory) return "";
  const directIds = new Set([territory.id]);
  const directCoplas = context.relatedCoplas.filter(copla =>
    (copla.territories || []).some(item => directIds.has(item.id))
  ).length;
  const inherited = Math.max(context.relatedCoplas.length - directCoplas, 0);

  if (!context.relatedCoplas.length) {
    return "Aínda non hai coplas vinculadas a este territorio nin aos seus subterritorios.";
  }

  if (!inherited) {
    return `${directCoplas} copla${directCoplas === 1 ? "" : "s"} vinculada${directCoplas === 1 ? "" : "s"} directamente a este territorio.`;
  }

  return `${directCoplas} directa${directCoplas === 1 ? "" : "s"} · ${inherited} herdada${inherited === 1 ? "" : "s"} dos subterritorios.`;
}

function renderCoplaPreview(context) {
  const preview = qs("#explorer-coplas-preview");
  const link = qs("#explorer-coplas-link");
  if (!preview) return;

  if (!selectedTerritory) {
    preview.innerHTML = `<p class="muted">Ao seleccionar un territorio verás aquí unha mostra lexible do corpus asociado.</p>`;
    if (link) link.href = pageHref("coplas");
    return;
  }

  if (link) {
    link.href = `${pageHref("coplas")}?territory_id=${encodeURIComponent(selectedTerritory.id)}`;
  }

  if (!context.relatedCoplas.length) {
    preview.innerHTML = `<p class="muted">Non hai coplas relacionadas con este lugar nos datos exportados.</p>`;
    return;
  }

  preview.innerHTML = context.relatedCoplas.slice(0, 4).map(copla => {
    const origin = (copla.territories || []).map(item => item.nome).join(", ") || "sen territorio";
    return `
      <article class="atlas-copla">
        <a href="${pageHref("coplas").replace("coplas.html", "copla.html")}?id=${encodeURIComponent(copla.id)}">
          <strong>${escapeHtml(copla.incipit || "(sen incipit)")}</strong>
        </a>
        <div class="atlas-copla-text">${nl2br(copla.text || "")}</div>
        <p class="atlas-copla-meta">${escapeHtml(origin)}</p>
      </article>
    `;
  }).join("");
}

function updateSummaryPanel() {
  const title = qs("#explorer-title");
  const subtitle = qs("#explorer-subtitle");
  const summary = qs("#explorer-summary");
  const children = qs("#explorer-children");
  const hierarchy = qs("#explorer-hierarchy");
  const actions = qs("#explorer-actions");

  if (!selectedTerritory) {
    if (title) title.textContent = "Explora Galicia desde o mapa";
    if (subtitle) subtitle.textContent = "Busca un lugar, cambia de capa e entra no territorio desde a cartografía.";
    if (summary) {
      summary.innerHTML = `
        <div class="explorer-stat"><strong>${territorios.length}</strong><span>territorios</span></div>
        <div class="explorer-stat"><strong>${coplas.length}</strong><span>coplas</span></div>
        <div class="explorer-stat"><strong>${pieces.length}</strong><span>pezas</span></div>
        <div class="explorer-stat"><strong>${mediaItems.length}</strong><span>recursos</span></div>
      `;
    }
    if (children) children.innerHTML = `<p class="muted">Selecciona un territorio para ver a súa xerarquía, as coplas absorbidas e as rutas rápidas.</p>`;
    if (hierarchy) hierarchy.innerHTML = "";
    renderCoplaPreview(null);
    if (actions) {
      actions.innerHTML = `
        <a class="panel-action" href="${pageHref("coplas")}">Abrir corpus</a>
        <a class="panel-action" href="${pageHref("importar")}">Admin local</a>
      `;
    }
    return;
  }

  const context = currentContext();
  if (title) title.textContent = selectedTerritory.nome;
  if (subtitle) {
    subtitle.textContent = `${TYPE_LABELS[selectedTerritory.tipo] || selectedTerritory.tipo} · ${selectedTerritory.id}`;
  }

  if (summary) {
    summary.innerHTML = `
      <div class="explorer-stat"><strong>${context.relatedCoplas.length}</strong><span>coplas absorbidas</span></div>
      <div class="explorer-stat"><strong>${context.relatedPieces.length}</strong><span>pezas</span></div>
      <div class="explorer-stat"><strong>${context.relatedMedia.length}</strong><span>media</span></div>
      <div class="explorer-stat"><strong>${context.children.length}</strong><span>subterritorios</span></div>
    `;
  }

  if (subtitle) {
    subtitle.textContent = `${TYPE_LABELS[selectedTerritory.tipo] || selectedTerritory.tipo} · ${selectedTerritory.id}. ${summarizeInheritance(selectedTerritory, context)}`;
  }

  if (hierarchy) {
    hierarchy.innerHTML = context.hierarchy.map(item => `
      <button type="button" class="compact-chip" data-select-territory="${item.id}">${territoryLabel(item)}</button>
    `).join("");
  }

  if (children) {
    if (!context.children.length) {
      children.innerHTML = `<p class="muted">Non hai subterritorios directos neste nivel.</p>`;
    } else {
      children.innerHTML = context.children
        .slice(0, 16)
        .map(item => `
          <button type="button" class="linked-item linked-item-button" data-select-territory="${item.id}">
            <span class="linked-item-title">${item.nome}</span>
            <span class="linked-item-meta">${TYPE_LABELS[item.tipo] || item.tipo}</span>
          </button>
        `)
        .join("");
    }
  }

  renderCoplaPreview(context);

  if (actions) {
    actions.innerHTML = `
      <a class="panel-action" href="${pageHref("territory")}?id=${encodeURIComponent(selectedTerritory.id)}">Abrir ficha</a>
      <a class="panel-action" href="${pageHref("coplas")}?territory_id=${encodeURIComponent(selectedTerritory.id)}">Ver coplas</a>
      <a class="panel-action" href="${pageHref("pezas")}?territory_id=${encodeURIComponent(selectedTerritory.id)}">Montar peza</a>
    `;
  }

  document.querySelectorAll("[data-select-territory]").forEach(button => {
    button.addEventListener("click", async () => {
      const territory = territorios.find(item => item.id === button.dataset.selectTerritory);
      if (!territory) return;
      await selectTerritory(territory, true);
    });
  });
}

function renderSearchResults(query = "") {
  const container = qs("#explorer-results");
  if (!container) return;

  if (!query.trim()) {
    container.innerHTML = "";
    return;
  }

  const results = searchTerritories(territorios, query);
  if (!results.length) {
    container.innerHTML = `<p class="muted">Sen coincidencias para esa busca.</p>`;
    return;
  }

  container.innerHTML = results.map(item => `
    <button type="button" class="explorer-result" data-territory-id="${item.id}">
      <strong>${item.nome}</strong>
      <span>${TYPE_LABELS[item.tipo] || item.tipo} · ${item.id}</span>
    </button>
  `).join("");

  container.querySelectorAll("[data-territory-id]").forEach(button => {
    button.addEventListener("click", async () => {
      const territory = territorios.find(item => item.id === button.dataset.territoryId);
      if (!territory) return;
      await selectTerritory(territory, true);
      const input = qs("#explorer-search");
      if (input) input.value = territory.nome;
      renderSearchResults(territory.nome);
    });
  });
}

function isExactTerritoryMatch(territory, rawQuery) {
  const query = normalizeText(rawQuery || "");
  if (!query || !territory) return false;

  return normalizeText(territory.nome || "") === query ||
    normalizeText(territory.search || "") === query ||
    normalizeText(territory.id || "") === query;
}

async function selectBestSearchResult(rawQuery) {
  const query = normalizeText(rawQuery || "");
  if (!query) return false;

  const results = searchTerritories(territorios, query);
  if (!results.length) return false;

  const top = results[0];
  const exact = isExactTerritoryMatch(top, query);

  if (!exact && results.length > 1) {
    return false;
  }

  await selectTerritory(top, true);
  return true;
}

async function loadLayer(tipo = "con") {
  const sequence = ++loadSequence;
  currentLayerType = tipo;
  if (!map) return;

  if (currentLayer) {
    currentLayer.remove();
  }

  setLayerStatus(`Cargando ${TYPE_LABELS[tipo]?.toLowerCase() || "capa"}...`, "loading");

  try {
    let data = await getGeoLayer(tipo);
    if (sequence !== loadSequence) return;
    if (tipo === "par" && data.type === "Topology") {
      data = topoToGeo(data);
    }

    currentLayer = L.geoJSON(data, {
      style: () => styleForLayer(false),
      onEachFeature(feature, layer) {
        const terr = findTerritoryByFeature(feature, tipo, territorios);
        const nome = terr?.nome || getFeatureNome(feature, tipo);

        layer.bindTooltip(nome, {
          sticky: true,
          direction: "auto",
        });

        layer.on("mouseover", () => {
          if (selectedTerritory?.id === terr?.id) return;
          layer.setStyle({
            weight: 2,
            color: "#f28f3b",
            fillOpacity: 0.42,
          });
        });

        layer.on("mouseout", () => {
          if (selectedTerritory?.id === terr?.id) {
            layer.setStyle(styleForLayer(true));
            return;
          }
          currentLayer.resetStyle(layer);
        });

        layer.on("click", async () => {
          if (!terr) return;
          await selectTerritory(terr, false);
        });
      },
    }).addTo(map);

    setLayerStatus(`${TYPE_LABELS[tipo] || "Capa"} cargada`, "ready");

    if (!suppressAutoLayerFit) {
      try {
        map.fitBounds(currentLayer.getBounds(), { padding: [24, 24] });
      } catch {}
    }

    if (selectedTerritory && selectedTerritory.tipo === tipo) {
      highlightSelectedFeature();
    }
  } catch (err) {
    if (sequence !== loadSequence) return;
    setLayerStatus(err.message || "Non se puido cargar a capa cartográfica.", "error");
  }
}

function highlightSelectedFeature() {
  if (!currentLayer || !selectedTerritory) return;

  currentLayer.eachLayer(layer => {
    const feature = layer.feature;
    const terr = findTerritoryByFeature(feature, currentLayerType, territorios);
    if (terr?.id === selectedTerritory.id) {
      layer.setStyle(styleForLayer(true));
      highlightLayer = layer;
      try {
        map.flyToBounds(layer.getBounds(), { padding: [48, 48], duration: 0.45 });
      } catch {}
    } else {
      currentLayer.resetStyle(layer);
    }
  });
}

async function selectTerritory(territory, forceLayerSwitch) {
  selectedTerritory = territory;

  const layerSelect = qs("#explorer-layer");
  if ((forceLayerSwitch || territory.tipo !== currentLayerType) && layerSelect) {
    layerSelect.value = territory.tipo;
    suppressAutoLayerFit = true;
    await loadLayer(territory.tipo);
    suppressAutoLayerFit = false;
  } else {
    highlightSelectedFeature();
  }

  updateSummaryPanel();
}

export async function initExplorer({ defaultLayer = "con", initialTerritoryId = null } = {}) {
  territorios = await getTerritorios();
  [coplas, pieces, mediaItems] = await Promise.all([getCoplas(), getPezas(), getMedia()]);

  const mapTarget = qs("#explorer-map");
  if (!mapTarget || !window.L) return;

  map = L.map("explorer-map", {
    zoomControl: true,
    attributionControl: true,
  }).setView([42.8, -8.2], 8);

  window.setTimeout(() => map.invalidateSize(), 80);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(map);

  const layerSelect = qs("#explorer-layer");
  if (layerSelect) {
    layerSelect.value = defaultLayer;
    layerSelect.addEventListener("change", async () => {
      await loadLayer(layerSelect.value);
    });
  }

  const searchInput = qs("#explorer-search");
  searchInput?.addEventListener("input", () => {
    renderSearchResults(searchInput.value);
    const results = searchTerritories(territorios, searchInput.value);
    if (results.length && isExactTerritoryMatch(results[0], searchInput.value)) {
      selectTerritory(results[0], true);
    }
  });
  searchInput?.addEventListener("keydown", async event => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const matched = await selectBestSearchResult(searchInput.value);
    if (matched) {
      renderSearchResults(searchInput.value);
    }
  });

  await loadLayer(defaultLayer);

  const territoryId = initialTerritoryId || getParam("territory_id");
  if (territoryId) {
    const territory = territorios.find(item => item.id === territoryId);
    if (territory) {
      await selectTerritory(territory, true);
      if (searchInput) searchInput.value = territory.nome;
    }
  }

  updateSummaryPanel();
}
