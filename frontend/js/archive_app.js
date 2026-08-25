import { clearApiCache, getCoplas, getGeoLayer, getMedia, getPezas, getTerritorios } from "./api.js";
import { escapeHtml, nl2br, normalizeText, slugify } from "./utils.js";
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

const RHYTHMS = ["xota", "muiñeira", "pasodobre", "valse", "dansa", "dous pasos", "mazurca", "polca", "rumba", "alalá"];
const DRAFT_KEY = "fol-e-ar-builder-v1";
const BATCH_KEY = "fol-e-ar-submit-v1";

const state = {
  territorios: [],
  coplas: [],
  pezas: [],
  media: [],
  map: null,
  layer: null,
  layerType: "con",
  selectedTerritory: null,
  selectedCoplaId: null,
  mode: "place",
  coplaViewMode: "grid",
  corpusQuery: "",
  corpusStateFilter: "",
  workbenchCollapsed: false,
  workbenchFocused: false,
  submitTerritoryId: "",
};

const $ = (selector, root = document) => root.querySelector(selector);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function defaultDraft() {
  return {
    title: "",
    author: "",
    territoryId: "",
    sections: [
      { id: "xota", label: "xota", coplas: [] },
      { id: "muineira", label: "muiñeira", coplas: [] },
    ],
  };
}

function loadDraft() {
  try {
    const raw = JSON.parse(localStorage.getItem(DRAFT_KEY));
    if (!raw || typeof raw !== "object") return defaultDraft();
    return {
      ...defaultDraft(),
      ...raw,
      sections: Array.isArray(raw.sections) && raw.sections.length ? raw.sections : defaultDraft().sections,
    };
  } catch {
    return defaultDraft();
  }
}

function saveDraft(draft) {
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  return draft;
}

function loadBatch() {
  try {
    const raw = JSON.parse(localStorage.getItem(BATCH_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveBatch(batch) {
  localStorage.setItem(BATCH_KEY, JSON.stringify(batch));
  return batch;
}

function setMode(mode) {
  state.mode = mode;
  all("[data-mode]").forEach(tab => tab.classList.toggle("is-active", tab.dataset.mode === mode));
  all(".mode-view").forEach(view => view.classList.toggle("is-active", view.id === `${mode}-view`));
  document.body.classList.toggle("is-builder-mode", mode === "builder");
  renderActiveView();
}

function syncWorkbenchChrome() {
  document.body.classList.toggle("workbench-collapsed", state.workbenchCollapsed);
  document.body.classList.toggle("workbench-focused", state.workbenchFocused);
  const collapse = $("#collapse-workbench");
  const focus = $("#focus-workbench");
  if (collapse) {
    collapse.title = state.workbenchCollapsed ? "Abrir panel" : "Colapsar panel";
    collapse.setAttribute("aria-label", collapse.title);
  }
  if (focus) {
    focus.title = state.workbenchFocused ? "Volver a mapa e panel" : "Ver panel a pantalla completa";
    focus.setAttribute("aria-label", focus.title);
  }
  window.setTimeout(() => state.map?.invalidateSize(), 220);
}

function topoToGeo(data) {
  if (data?.type !== "Topology" || !window.topojson) return data;
  const objectName = Object.keys(data.objects || {})[0];
  return window.topojson.feature(data, data.objects[objectName]);
}

function placeContext(territory = state.selectedTerritory) {
  if (!territory) {
    return { hierarchy: [], children: [], descendantIds: [], coplas: [], pezas: [], media: [] };
  }
  const descendantIds = getDescendantIds(territory, state.territorios);
  const coplas = filterCoplasByTerritory(state.coplas, descendantIds);
  const pezas = filterPiecesByTerritory(state.pezas, descendantIds, coplas);
  const media = filterMediaByContext(state.media, descendantIds, coplas, pezas);
  return {
    hierarchy: buildHierarchy(territory, state.territorios),
    children: getChildren(territory, state.territorios),
    descendantIds,
    coplas,
    pezas,
    media,
  };
}

function territoryLine(territory) {
  return territory ? `${TYPE_LABELS[territory.tipo] || territory.tipo}` : "Sen territorio";
}

function coplaPlaceLabel(copla) {
  if ((copla.territories || []).length) return copla.territories.map(item => item.nome).join(", ");
  if (copla.territory_state === "general") return "Galiza xeral";
  if (copla.territory_state === "unassigned") return "Lugar descoñecido";
  return "Sen territorio";
}

function styleFeature(selected = false) {
  return selected
    ? { weight: 2.4, color: "#f2efe5", fillColor: "#b84a32", fillOpacity: 0.72 }
    : { weight: 1, color: "#243b3d", fillColor: "#49706d", fillOpacity: 0.22 };
}

async function loadLayer(type = state.layerType) {
  state.layerType = type;
  $("#map-status-text").textContent = `Cargando ${TYPE_LABELS[type]?.toLowerCase() || "capa"}...`;
  if (state.layer) state.layer.remove();

  let data = await getGeoLayer(type);
  data = topoToGeo(data);
  state.layer = L.geoJSON(data, {
    style: feature => {
      const territory = findTerritoryByFeature(feature, type, state.territorios);
      return styleFeature(territory?.id === state.selectedTerritory?.id);
    },
    onEachFeature(feature, layer) {
      const territory = findTerritoryByFeature(feature, type, state.territorios);
      const name = territory?.nome || getFeatureNome(feature, type);
      layer.bindTooltip(name, { sticky: true, direction: "auto" });
      layer.on("mouseover", () => {
        if (territory?.id !== state.selectedTerritory?.id) {
          layer.setStyle({ weight: 2, color: "#b84a32", fillOpacity: 0.42 });
        }
      });
      layer.on("mouseout", () => state.layer?.resetStyle(layer));
      layer.on("click", () => {
        if (territory) selectTerritory(territory, { switchMode: true, fit: false });
      });
    },
  }).addTo(state.map);

  try {
    state.map.fitBounds(state.layer.getBounds(), { padding: [20, 20] });
  } catch {}
  $("#map-status-text").textContent = `${TYPE_LABELS[type] || "Capa"} activa`;
}

async function selectTerritory(territory, options = {}) {
  state.selectedTerritory = territory;
  if (options.switchMode) setMode("place");
  const layerSelect = $("#map-layer");
  if (territory.tipo !== state.layerType) {
    if (layerSelect) layerSelect.value = territory.tipo;
    await loadLayer(territory.tipo);
  }
  state.layer?.eachLayer(layer => {
    const found = findTerritoryByFeature(layer.feature, state.layerType, state.territorios);
    layer.setStyle(styleFeature(found?.id === territory.id));
    if (found?.id === territory.id && options.fit !== false) {
      try {
        state.map.flyToBounds(layer.getBounds(), { padding: [52, 52], duration: 0.45 });
      } catch {}
    }
  });
  renderActiveView();
}

function renderSearch(query = "") {
  const box = $("#search-results");
  const q = query.trim();
  if (!q) {
    box.innerHTML = "";
    return;
  }
  const territoryHits = searchTerritories(state.territorios, q).slice(0, 7);
  const textQ = normalizeText(q);
  const coplaHits = state.coplas.filter(copla => {
    const haystack = [
      copla.text,
      copla.incipit,
      copla.notes,
      (copla.tags || []).join(" "),
      (copla.versions || []).map(version => `${version.text} ${version.notes || ""}`).join(" "),
    ].join(" ");
    return normalizeText(haystack).includes(textQ);
  }).slice(0, 5);

  box.innerHTML = `
    ${territoryHits.map(item => `
      <button type="button" class="search-hit" data-territory-id="${item.id}">
        <strong>${escapeHtml(item.nome)}</strong>
        <span>${escapeHtml(territoryLine(item))}</span>
      </button>
    `).join("")}
    ${coplaHits.map(item => `
      <button type="button" class="search-hit" data-copla-id="${item.id}">
        <strong>${escapeHtml(item.incipit || `Copla #${item.id}`)}</strong>
        <span>${escapeHtml(coplaPlaceLabel(item))}</span>
      </button>
    `).join("")}
    ${!territoryHits.length && !coplaHits.length ? `<p class="quiet">Sen resultados.</p>` : ""}
  `;

  all("[data-territory-id]", box).forEach(button => {
    button.addEventListener("click", () => {
      const territory = state.territorios.find(item => item.id === button.dataset.territoryId);
      if (territory) selectTerritory(territory, { switchMode: true });
    });
  });
  all("[data-copla-id]", box).forEach(button => {
    button.addEventListener("click", () => {
      state.selectedCoplaId = Number(button.dataset.coplaId);
      setMode("corpus");
    });
  });
}

function renderPlaceFinder() {
  return `
    <section class="place-finder">
      <label for="place-search">Buscar lugar</label>
      <div class="place-search-row">
        <input id="place-search" type="search" placeholder="Malpica, O Temple, Barro de Arén...">
      </div>
      <div id="place-search-results" class="place-search-results"></div>
    </section>
  `;
}

function bindPlaceFinder(root) {
  const input = $("#place-search", root);
  const results = $("#place-search-results", root);
  if (!input || !results) return;

  input.addEventListener("input", () => {
    const query = input.value.trim();
    if (!query) {
      results.innerHTML = "";
      return;
    }
    const matches = searchTerritories(state.territorios, query).slice(0, 12);
    results.innerHTML = matches.map(item => `
      <button type="button" data-place-result="${item.id}">
        <strong>${escapeHtml(item.nome)}</strong>
        <span>${escapeHtml(TYPE_LABELS[item.tipo] || item.tipo)}</span>
      </button>
    `).join("") || `<p class="quiet">Sen resultados.</p>`;
    all("[data-place-result]", results).forEach(button => {
      button.addEventListener("click", () => {
        const territory = state.territorios.find(item => item.id === button.dataset.placeResult);
        if (territory) selectTerritory(territory, { switchMode: true });
      });
    });
  });

  input.addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const first = searchTerritories(state.territorios, input.value)[0];
    if (first) selectTerritory(first, { switchMode: true });
  });
}

function renderPlaceView() {
  const view = $("#place-view");
  const territory = state.selectedTerritory;
  const ctx = placeContext(territory);
  if (!territory) {
    view.innerHTML = `
      <div class="view-head">
        <p class="micro-label">Lugar</p>
        <h2>Escolle un punto do atlas</h2>
        <p class="quiet">O territorio é unha porta de entrada, non unha gaiola: tamén hai coplas xerais, sen adscrición e variantes textuais.</p>
      </div>
      ${renderPlaceFinder()}
      <div class="metric-grid">
        <div class="metric"><strong>${state.territorios.length}</strong><span>lugares</span></div>
        <div class="metric"><strong>${state.coplas.length}</strong><span>coplas</span></div>
        <div class="metric"><strong>${state.media.length}</strong><span>media</span></div>
      </div>
      <div class="future-strip">
        <strong>PMV musical</strong>
        <span>Cada lugar reserva espazo para melodías: mp3, mp4, gravacións, vídeos e ligazóns tratadas segundo a fonte.</span>
      </div>
    `;
    bindPlaceFinder(view);
    return;
  }

  const direct = ctx.coplas.filter(copla => (copla.territories || []).some(item => item.id === territory.id)).length;
  const inherited = Math.max(ctx.coplas.length - direct, 0);
  const directCoplas = ctx.coplas.filter(copla => (copla.territories || []).some(item => item.id === territory.id));
  const inheritedCoplas = ctx.coplas.filter(copla => !(copla.territories || []).some(item => item.id === territory.id));
  view.innerHTML = `
    <div class="view-head">
      <p class="micro-label">${escapeHtml(TYPE_LABELS[territory.tipo] || territory.tipo)}</p>
      <h2>${escapeHtml(territory.nome)}</h2>
      <p class="quiet">${direct} directas · ${inherited} herdadas</p>
    </div>
    ${renderPlaceFinder()}
    <div class="metric-grid">
      <div class="metric"><strong>${ctx.coplas.length}</strong><span>coplas</span></div>
      <div class="metric"><strong>${ctx.children.length}</strong><span>subterritorios</span></div>
      <div class="metric"><strong>${ctx.media.length}</strong><span>media</span></div>
    </div>
    <section class="panel-block">
      <h3>Xerarquía</h3>
      <div class="chip-row">${ctx.hierarchy.map(item => `<button class="chip" type="button" data-territory-id="${item.id}">${escapeHtml(item.nome)}</button>`).join("")}</div>
    </section>
    <section class="panel-block">
      <div class="block-title">
        <h3>Coplas do lugar</h3>
        <button class="text-button" type="button" data-mode-jump="corpus">Abrir corpus</button>
      </div>
      <div class="territory-coplas">
        ${directCoplas.length ? `
          <div class="territory-copla-group">
            <p class="micro-label">Directas</p>
            ${directCoplas.slice(0, 6).map(copla => placeCoplaRow(copla)).join("")}
          </div>
        ` : ""}
        ${inheritedCoplas.length ? `
          <div class="territory-copla-group">
            <p class="micro-label">Herdadas dos subterritorios</p>
            ${inheritedCoplas.slice(0, 6).map(copla => placeCoplaRow(copla)).join("")}
          </div>
        ` : ""}
        ${!ctx.coplas.length ? `<p class="quiet">Aínda non hai coplas neste lugar.</p>` : ""}
      </div>
    </section>
    <section class="panel-block">
      <h3>Melodías e media</h3>
      <div class="media-lanes">
        <article><strong>Melodías locais</strong><span>Preparado para mp3/mp4, gravacións de campo e vídeos cantados.</span></article>
        <article><strong>Ligazóns tratadas</strong><span>YouTube, Spotify, webs externas e arquivos propios terán visualización diferenciada.</span></article>
        <article><strong>Agora mesmo</strong><span>${ctx.media.length ? `${ctx.media.length} recursos ligados` : "sen media ligada"}</span></article>
      </div>
    </section>
    <section class="panel-block">
      <h3>Subterritorios</h3>
      <div class="place-list">${ctx.children.slice(0, 12).map(item => `<button type="button" data-territory-id="${item.id}"><strong>${escapeHtml(item.nome)}</strong><span>${escapeHtml(TYPE_LABELS[item.tipo] || item.tipo)}</span></button>`).join("") || `<p class="quiet">Sen subterritorios neste nivel.</p>`}</div>
    </section>
  `;

  all("[data-territory-id]", view).forEach(button => {
    button.addEventListener("click", () => {
      const next = state.territorios.find(item => item.id === button.dataset.territoryId);
      if (next) selectTerritory(next, { switchMode: true });
    });
  });
  all("[data-mode-jump]", view).forEach(button => button.addEventListener("click", () => setMode(button.dataset.modeJump)));
  bindPlaceFinder(view);
  bindCoplaButtons(view);
}

function placeCoplaRow(copla) {
  const excerpt = String(copla.text || "").replace(/\s+/g, " ").trim();
  return `
    <article class="territory-copla-row">
      <button type="button" class="copla-title" data-open-copla="${copla.id}">${escapeHtml(copla.incipit || `Copla #${copla.id}`)}</button>
      <p>${escapeHtml(excerpt)}</p>
      <div class="copla-meta">
        <span>${escapeHtml(coplaPlaceLabel(copla))}</span>
        <span>${(copla.versions || []).length ? `${(copla.versions || []).length} variantes` : "texto único"}</span>
      </div>
      <div class="unit-actions">
        <button type="button" data-add-to-builder="${copla.id}">Obradoiro</button>
        <button type="button" data-open-copla="${copla.id}">Ler</button>
      </div>
    </article>
  `;
}

function coplaCard(copla, options = {}) {
  const versionCount = (copla.versions || []).length;
  const tags = (copla.tags || []).slice(0, 4);
  return `
    <article class="copla-unit ${options.compact ? "is-compact" : ""} ${options.gallery ? "is-gallery" : ""}">
      <div class="copla-topline">
        <button type="button" class="copla-title" data-open-copla="${copla.id}">${escapeHtml(copla.incipit || `Copla #${copla.id}`)}</button>
        <span class="state-badge">${escapeHtml(copla.territory_state || "assigned")}</span>
      </div>
      <div class="copla-body">${nl2br(copla.text || "")}</div>
      <div class="copla-meta"><span>${escapeHtml(coplaPlaceLabel(copla))}</span><span>${versionCount ? `${versionCount} variantes` : "texto único"}</span></div>
      ${tags.length ? `<div class="chip-row">${tags.map(tag => `<span class="tag-chip">${escapeHtml(tag)}</span>`).join("")}</div>` : ""}
      <div class="unit-actions">
        <button type="button" data-add-to-builder="${copla.id}">Levar ao obradoiro</button>
        <button type="button" data-open-copla="${copla.id}">Contrastar</button>
      </div>
    </article>
  `;
}

function corpusMatches(copla, query) {
  const q = normalizeText(query || "");
  if (!q) return true;
  const haystack = [
    copla.text,
    copla.incipit,
    copla.notes,
    coplaPlaceLabel(copla),
    (copla.tags || []).join(" "),
    (copla.versions || []).map(version => `${version.text} ${version.label || ""} ${version.notes || ""}`).join(" "),
  ].join(" ");
  return normalizeText(haystack).includes(q);
}

function currentCorpusItems() {
  const ctx = placeContext();
  const scoped = state.selectedTerritory ? ctx.coplas : state.coplas;
  return scoped.filter(copla => {
    const stateOk = !state.corpusStateFilter || copla.territory_state === state.corpusStateFilter;
    return stateOk && corpusMatches(copla, state.corpusQuery);
  });
}

function renderCorpusList(view) {
  const stream = $(".copla-stream", view);
  const count = $("#corpus-count", view);
  if (!stream) return;
  const items = currentCorpusItems();
  stream.className = `copla-stream is-${state.coplaViewMode}`;
  stream.innerHTML = items.map(copla => coplaCard(copla, {
    compact: state.coplaViewMode !== "list",
    gallery: state.coplaViewMode === "gallery",
  })).join("") || `<p class="quiet">Sen coplas neste ámbito.</p>`;
  if (count) count.textContent = `${items.length} coplas`;
  all("[data-view-mode]", view).forEach(button => button.classList.toggle("is-active", button.dataset.viewMode === state.coplaViewMode));
  all("[data-filter-state]", view).forEach(button => button.classList.toggle("is-active", button.dataset.filterState === state.corpusStateFilter));
  bindCoplaButtons(view);
}

function renderCorpusView() {
  const view = $("#corpus-view");
  const selected = state.selectedCoplaId ? state.coplas.find(item => Number(item.id) === Number(state.selectedCoplaId)) : null;
  const assigned = state.coplas.filter(item => item.territory_state === "assigned").length;
  const unassigned = state.coplas.filter(item => item.territory_state === "unassigned").length;
  const general = state.coplas.filter(item => item.territory_state === "general").length;
  const baseCount = state.selectedTerritory ? placeContext().coplas.length : state.coplas.length;
  view.innerHTML = `
    <div class="view-head">
      <p class="micro-label">Corpus</p>
      <h2>${state.selectedTerritory ? `Coplas de ${escapeHtml(state.selectedTerritory.nome)}` : "Arquivo textual"}</h2>
      <p class="quiet">Unha copla é unha unidade textual con versións, adscrición territorial e usos posibles.</p>
    </div>
    <div class="metric-grid">
      <button class="metric metric-button" type="button" data-filter-state=""><strong>${baseCount}</strong><span>todas</span></button>
      <button class="metric metric-button" type="button" data-filter-state="assigned"><strong>${assigned}</strong><span>asignadas</span></button>
      <button class="metric metric-button" type="button" data-filter-state="unassigned"><strong>${unassigned}</strong><span>sen lugar</span></button>
      <button class="metric metric-button" type="button" data-filter-state="general"><strong>${general}</strong><span>xerais</span></button>
    </div>
    ${selected ? renderCoplaDetail(selected) : ""}
    <section class="panel-block">
      <div class="corpus-toolbar">
        <label class="corpus-search"><span class="visually-hidden">Buscar coplas</span><input id="corpus-search" type="search" value="${escapeHtml(state.corpusQuery)}" placeholder="Buscar por verso, íncipit, territorio, etiqueta..."></label>
        <div class="view-switcher" aria-label="Tipo de visualización">
          <button type="button" data-view-mode="grid">Grade</button>
          <button type="button" data-view-mode="list">Lista</button>
          <button type="button" data-view-mode="gallery">Galería</button>
        </div>
      </div>
      <div class="block-title"><h3 id="corpus-count">0 coplas</h3><span class="quiet">${state.selectedTerritory ? "inclúe herdadas dos subterritorios" : "todo o corpus exportado"}</span></div>
      <div class="copla-stream"></div>
    </section>
  `;
  $("#corpus-search", view)?.addEventListener("input", event => {
    state.corpusQuery = event.target.value;
    renderCorpusList(view);
  });
  all("[data-view-mode]", view).forEach(button => button.addEventListener("click", () => {
    state.coplaViewMode = button.dataset.viewMode;
    renderCorpusList(view);
  }));
  all("[data-filter-state]", view).forEach(button => {
    button.addEventListener("click", () => {
      state.corpusStateFilter = button.dataset.filterState;
      renderCorpusList(view);
    });
  });
  renderCorpusList(view);
}

function renderCoplaDetail(copla) {
  return `
    <section class="copla-detail">
      <div class="block-title"><h3>${escapeHtml(copla.incipit || `Copla #${copla.id}`)}</h3><button class="text-button" type="button" data-close-copla>Pechar</button></div>
      <div class="comparison-grid">
        <article><p class="micro-label">Texto canónico</p><div class="copla-body">${nl2br(copla.text || "")}</div></article>
        <article><p class="micro-label">Variantes</p>${(copla.versions || []).map(version => `<div class="variant"><strong>${escapeHtml(version.label || version.incipit || "Versión")}</strong><div>${nl2br(version.text || "")}</div>${version.notes ? `<span>${escapeHtml(version.notes)}</span>` : ""}</div>`).join("") || `<p class="quiet">Sen variantes rexistradas.</p>`}</article>
      </div>
    </section>
  `;
}

function bindCoplaButtons(root = document) {
  all("[data-open-copla]", root).forEach(button => {
    button.addEventListener("click", () => {
      state.selectedCoplaId = Number(button.dataset.openCopla);
      setMode("corpus");
    });
  });
  all("[data-close-copla]", root).forEach(button => {
    button.addEventListener("click", () => {
      state.selectedCoplaId = null;
      renderCorpusView();
    });
  });
  all("[data-add-to-builder]", root).forEach(button => {
    button.addEventListener("click", () => {
      const copla = state.coplas.find(item => Number(item.id) === Number(button.dataset.addToBuilder));
      if (!copla) return;
      const draft = loadDraft();
      if (state.selectedTerritory && !draft.territoryId) draft.territoryId = state.selectedTerritory.id;
      if (state.selectedTerritory && !draft.title) draft.title = state.selectedTerritory.nome;
      const first = draft.sections[0];
      if (!draft.sections.some(section => section.coplas.some(item => Number(item.id) === Number(copla.id)))) {
        first.coplas.push({ id: copla.id, incipit: copla.incipit || "", text: copla.text || "", territory: coplaPlaceLabel(copla) });
      }
      saveDraft(draft);
      setMode("builder");
    });
  });
}

function renderBuilderView() {
  const view = $("#builder-view");
  const draft = loadDraft();
  const territory = state.territorios.find(item => item.id === draft.territoryId) || state.selectedTerritory;
  const total = draft.sections.reduce((sum, section) => sum + section.coplas.length, 0);
  const rhythmOptions = RHYTHMS.map(value => `<option value="${value}">${value}</option>`).join("");
  view.innerHTML = `
    <div class="view-head"><p class="micro-label">Obradoiro</p><h2>Construír letra cantábel</h2><p class="quiet">Unha peza pode ter partes: catro coplas para unha xota, catro para unha muiñeira, ou a estrutura que precise o uso real.</p></div>
    <section class="panel-block">
      <div class="form-grid">
        <label>Título<input id="builder-title" type="text" value="${escapeHtml(draft.title || territory?.nome || "")}" placeholder="Malpica"></label>
        <label>Autoría da selección<input id="builder-author" type="text" value="${escapeHtml(draft.author || "")}" placeholder="Nome da persoa que monta a letra"></label>
      </div>
      <p class="quiet">${total} coplas seleccionadas${territory ? ` · ${escapeHtml(territory.nome)}` : ""}</p>
    </section>
    <section class="panel-block">
      <div class="block-title"><h3>Partes</h3><button type="button" class="text-button" id="add-section">Engadir parte</button></div>
      <div class="builder-sections">
        ${draft.sections.map(section => `<article class="builder-section" data-section-id="${section.id}">
          <div class="section-line"><select data-section-label="${section.id}">${rhythmOptions}</select><button type="button" data-remove-section="${section.id}">Quitar</button></div>
          <div class="copla-stack" data-drop-section="${section.id}">
            ${section.coplas.map(item => `
              <article class="builder-copla" draggable="true" data-drag-copla="${item.id}" data-section="${section.id}" tabindex="0">
                <strong>${escapeHtml(item.incipit || `Copla #${item.id}`)}</strong>
                <span>${escapeHtml(item.territory || "")}</span>
                <div class="builder-copla-preview">${nl2br(item.text || "")}</div>
                <div class="unit-actions">
                  <button type="button" data-up="${item.id}" data-section="${section.id}">Subir</button>
                  <button type="button" data-down="${item.id}" data-section="${section.id}">Baixar</button>
                  <button type="button" data-remove-copla="${item.id}">Quitar</button>
                </div>
              </article>
            `).join("") || `<p class="quiet">Arrastra aquí coplas desde outra parte ou engádeas desde Lugar/Corpus.</p>`}
          </div>
        </article>`).join("")}
      </div>
    </section>
    <section class="panel-block"><h3>Exportar</h3><div class="unit-actions"><button type="button" id="download-piece-json">JSON para importar peza</button><button type="button" id="open-a4">Folla A4 / gardar PDF</button><button type="button" id="clear-builder">Limpar obradoiro</button></div></section>
  `;
  draft.sections.forEach(section => {
    const select = $(`[data-section-label="${section.id}"]`, view);
    if (select) select.value = section.label;
  });
  $("#builder-title")?.addEventListener("input", event => saveDraft({ ...loadDraft(), title: event.target.value }));
  $("#builder-author")?.addEventListener("input", event => saveDraft({ ...loadDraft(), author: event.target.value }));
  $("#add-section")?.addEventListener("click", () => {
    const next = loadDraft();
    next.sections.push({ id: `section-${Date.now()}`, label: "xota", coplas: [] });
    saveDraft(next);
    renderBuilderView();
  });
  all("[data-section-label]", view).forEach(select => select.addEventListener("change", () => {
    const next = loadDraft();
    const section = next.sections.find(item => item.id === select.dataset.sectionLabel);
    if (section) section.label = select.value;
    saveDraft(next);
    renderBuilderView();
  }));
  all("[data-remove-section]", view).forEach(button => button.addEventListener("click", () => {
    const next = loadDraft();
    if (next.sections.length > 1) next.sections = next.sections.filter(item => item.id !== button.dataset.removeSection);
    saveDraft(next);
    renderBuilderView();
  }));
  all("[data-remove-copla]", view).forEach(button => button.addEventListener("click", () => {
    const next = loadDraft();
    next.sections.forEach(section => {
      section.coplas = section.coplas.filter(item => Number(item.id) !== Number(button.dataset.removeCopla));
    });
    saveDraft(next);
    renderBuilderView();
  }));
  all("[data-up], [data-down]", view).forEach(button => button.addEventListener("click", () => {
    const next = loadDraft();
    const section = next.sections.find(item => item.id === button.dataset.section);
    const coplaId = Number(button.dataset.up || button.dataset.down);
    const index = section?.coplas.findIndex(item => Number(item.id) === coplaId) ?? -1;
    const target = button.dataset.up ? index - 1 : index + 1;
    if (section && index >= 0 && target >= 0 && target < section.coplas.length) {
      const [item] = section.coplas.splice(index, 1);
      section.coplas.splice(target, 0, item);
      saveDraft(next);
      renderBuilderView();
    }
  }));
  bindBuilderDrag(view);
  $("#download-piece-json")?.addEventListener("click", () => downloadText("peza.json", JSON.stringify(buildPiecePayload(), null, 2), "application/json"));
  $("#open-a4")?.addEventListener("click", openA4Sheet);
  $("#clear-builder")?.addEventListener("click", () => {
    saveDraft(defaultDraft());
    renderBuilderView();
  });
}

function buildPiecePayload() {
  const draft = loadDraft();
  let position = 0;
  return {
    pieces: [{
      title: draft.title || "Peza sen título",
      slug: slugify(draft.title || "peza"),
      author: draft.author || "Sen autoría",
      context_territory_id: draft.territoryId || state.selectedTerritory?.id || null,
      description: "",
      notes: "",
      status: "draft",
      coplas: draft.sections.flatMap(section => section.coplas.map(copla => {
        position += 1;
        return { copla_id: Number(copla.id), position, section_label: section.label };
      })),
    }],
  };
}

function moveDraftCopla(coplaId, targetSectionId, beforeCoplaId = null) {
  const draft = loadDraft();
  let moving = null;
  draft.sections.forEach(section => {
    const index = section.coplas.findIndex(item => Number(item.id) === Number(coplaId));
    if (index >= 0) {
      [moving] = section.coplas.splice(index, 1);
    }
  });
  if (!moving) return;
  const target = draft.sections.find(section => section.id === targetSectionId) || draft.sections[0];
  const beforeIndex = beforeCoplaId
    ? target.coplas.findIndex(item => Number(item.id) === Number(beforeCoplaId))
    : -1;
  if (beforeIndex >= 0) target.coplas.splice(beforeIndex, 0, moving);
  else target.coplas.push(moving);
  saveDraft(draft);
  renderBuilderView();
}

function bindBuilderDrag(root) {
  all("[data-drag-copla]", root).forEach(card => {
    card.addEventListener("dragstart", event => {
      event.dataTransfer.setData("text/plain", card.dataset.dragCopla);
      event.dataTransfer.effectAllowed = "move";
      card.classList.add("is-dragging");
    });
    card.addEventListener("dragend", () => card.classList.remove("is-dragging"));
    card.addEventListener("dragover", event => event.preventDefault());
    card.addEventListener("drop", event => {
      event.preventDefault();
      const coplaId = event.dataTransfer.getData("text/plain");
      if (!coplaId || Number(coplaId) === Number(card.dataset.dragCopla)) return;
      moveDraftCopla(coplaId, card.dataset.section, card.dataset.dragCopla);
    });
  });

  all("[data-drop-section]", root).forEach(stack => {
    stack.addEventListener("dragover", event => {
      event.preventDefault();
      stack.classList.add("is-drop-target");
    });
    stack.addEventListener("dragleave", () => stack.classList.remove("is-drop-target"));
    stack.addEventListener("drop", event => {
      event.preventDefault();
      stack.classList.remove("is-drop-target");
      const coplaId = event.dataTransfer.getData("text/plain");
      if (coplaId) moveDraftCopla(coplaId, stack.dataset.dropSection);
    });
  });
}

function openA4Sheet() {
  const draft = loadDraft();
  const html = `<!doctype html><html lang="gl"><head><meta charset="utf-8"><title>${escapeHtml(draft.title || "Peza")}</title><style>@page{size:A4;margin:16mm}body{font-family:Avenir Next,Segoe UI,sans-serif;color:#1d2326}h1{font-size:24pt;margin:0 0 2mm}header{border-bottom:1px solid #bbb;padding-bottom:5mm;margin-bottom:8mm}.meta{color:#667;font-size:10pt}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10mm}.part{break-inside:avoid;margin-bottom:8mm}h2{text-transform:uppercase;font-size:12pt;color:#7f3326;letter-spacing:.08em}.copla{font-family:Georgia,serif;font-size:11pt;line-height:1.45;margin-bottom:5mm;white-space:pre-line}.incipit{font-weight:700;font-family:Avenir Next,Segoe UI,sans-serif;font-size:9pt;margin-bottom:1mm}</style></head><body><header><h1>${escapeHtml(draft.title || "Peza sen título")}</h1><div class="meta">${escapeHtml(draft.author || "Sen autoría")}</div></header><main class="grid">${draft.sections.filter(section => section.coplas.length).map(section => `<section class="part"><h2>${escapeHtml(section.label)}</h2>${section.coplas.map(copla => `<article><div class="incipit">${escapeHtml(copla.incipit || "")}</div><div class="copla">${escapeHtml(copla.text || "")}</div></article>`).join("")}</section>`).join("")}</main><script>window.print();</script></body></html>`;
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  window.open(url, "_blank", "noopener");
  window.setTimeout(() => URL.revokeObjectURL(url), 3000);
}

function renderSubmitView() {
  const view = $("#submit-view");
  const batch = loadBatch();
  const selectedTerritory = state.territorios.find(item => item.id === state.submitTerritoryId) || state.selectedTerritory;
  view.innerHTML = `
    <div class="view-head"><p class="micro-label">Alta local</p><h2>Nova copla ou variante</h2><p class="quiet">Se corres o proxecto con <code>./serve.sh</code>, este formulario pode gardar directamente na SQLite e rexenerar a web.</p></div>
    <section class="panel-block">
      <label>Texto principal<textarea id="new-text" rows="5" placeholder="Escribe a copla..."></textarea></label>
      <div class="form-grid">
        <label>Estado territorial<select id="new-state"><option value="assigned">Asignada a lugar</option><option value="unassigned">Lugar descoñecido</option><option value="general">Galiza xeral</option></select></label>
        <label>Territorio
          <input id="territory-query" type="search" value="${escapeHtml(selectedTerritory?.nome || "")}" placeholder="Buscar concello, parroquia, comarca...">
        </label>
      </div>
      <div id="territory-picker-results" class="territory-picker-results"></div>
      <p id="selected-territory-label" class="quiet">${selectedTerritory ? `Seleccionado: ${escapeHtml(selectedTerritory.nome)} (${escapeHtml(TYPE_LABELS[selectedTerritory.tipo] || selectedTerritory.tipo)})` : "Sen territorio seleccionado."}</p>
      <label>Etiquetas<input id="new-tags" type="text" placeholder="amor, romaría, traballo..."></label>
      <label>Notas<textarea id="new-notes" rows="3" placeholder="Fonte, contexto, dúbidas editoriais..."></textarea></label>
    </section>
    <section class="panel-block">
      <div class="block-title"><h3>Variantes</h3><button type="button" class="text-button" id="add-version-row">Engadir variante</button></div>
      <div id="version-rows" class="version-rows"></div>
    </section>
    <section class="panel-block">
      <div class="unit-actions"><button type="button" id="save-direct">Gardar na base local</button><button type="button" id="add-to-batch">Engadir ao lote</button><button type="button" id="download-batch">Exportar lote JSON</button><button type="button" id="clear-batch">Limpar lote</button></div>
      <p id="submit-feedback" class="quiet"></p>
      <p class="quiet">${batch.length} entradas no lote.</p>
      <pre class="json-preview">${escapeHtml(JSON.stringify({ coplas: batch }, null, 2))}</pre>
    </section>
  `;
  if (!state.submitTerritoryId && state.selectedTerritory) state.submitTerritoryId = state.selectedTerritory.id;
  bindTerritoryPicker();
  $("#add-version-row")?.addEventListener("click", () => {
    const row = document.createElement("div");
    row.className = "version-row";
    row.innerHTML = `<input type="text" placeholder="Etiqueta da variante"><textarea rows="3" placeholder="Texto da variante"></textarea><input type="text" placeholder="Notas">`;
    $("#version-rows").appendChild(row);
  });
  $("#add-to-batch")?.addEventListener("click", () => {
    const payload = buildCoplaPayloadFromForm();
    if (!payload) return;
    const next = loadBatch();
    next.unshift(payload);
    saveBatch(next);
    renderSubmitView();
  });
  $("#save-direct")?.addEventListener("click", saveCoplaDirect);
  $("#download-batch")?.addEventListener("click", () => downloadText("coplas-lote.json", JSON.stringify({ coplas: loadBatch() }, null, 2), "application/json"));
  $("#clear-batch")?.addEventListener("click", () => {
    saveBatch([]);
    renderSubmitView();
  });
}

function buildCoplaPayloadFromForm() {
    const text = $("#new-text").value.trim();
    if (!text) {
      $("#submit-feedback").textContent = "Escribe o texto da copla antes de gardar.";
      return null;
    }
    const territoryId = state.submitTerritoryId;
    const territoryState = $("#new-state").value;
    if (territoryState === "assigned" && !territoryId) {
      $("#submit-feedback").textContent = "Busca e selecciona un territorio, ou cambia o estado territorial.";
      return null;
    }
    const versions = all(".version-row").map(row => ({
      label: $("input", row).value,
      text: $("textarea", row).value,
      notes: all("input", row)[1].value,
    })).filter(item => item.text.trim());
    return {
      text,
      notes: $("#new-notes").value,
      status: "published",
      territory_state: territoryState,
      territories: territoryState === "assigned" && territoryId ? [{ id: territoryId }] : [],
      tags: $("#new-tags").value.split(",").map(item => normalizeText(item)).filter(Boolean),
      versions,
    };
}

function bindTerritoryPicker() {
  const input = $("#territory-query");
  const results = $("#territory-picker-results");
  const renderResults = () => {
    const q = input.value.trim();
    if (!q) {
      results.innerHTML = "";
      return;
    }
    const matches = searchTerritories(state.territorios, q).slice(0, 10);
    results.innerHTML = matches.map(item => `
      <button type="button" data-pick-territory="${item.id}">
        <strong>${escapeHtml(item.nome)}</strong>
        <span>${escapeHtml(TYPE_LABELS[item.tipo] || item.tipo)}</span>
      </button>
    `).join("") || `<p class="quiet">Sen resultados.</p>`;
    all("[data-pick-territory]", results).forEach(button => {
      button.addEventListener("click", () => {
        const territory = state.territorios.find(item => item.id === button.dataset.pickTerritory);
        if (!territory) return;
        state.submitTerritoryId = territory.id;
        input.value = territory.nome;
        $("#selected-territory-label").textContent = `Seleccionado: ${territory.nome} (${TYPE_LABELS[territory.tipo] || territory.tipo})`;
        results.innerHTML = "";
      });
    });
  };
  input.addEventListener("input", renderResults);
}

async function saveCoplaDirect() {
  const payload = buildCoplaPayloadFromForm();
  if (!payload) return;
  const feedback = $("#submit-feedback");
  feedback.textContent = "Gardando na base local...";
  try {
    const response = await fetch("../api/coplas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coplas: [payload] }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Non se puido gardar.");
    feedback.textContent = `Gardado. IDs afectados: ${result.ids.join(", ")}`;
    clearApiCache();
    state.coplas = await getCoplas();
  } catch (error) {
    feedback.textContent = `${error.message} Podes engadir ao lote e exportar JSON como alternativa.`;
  }
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([`${text}\n`], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderActiveView() {
  if (state.mode === "place") renderPlaceView();
  if (state.mode === "corpus") renderCorpusView();
  if (state.mode === "builder") renderBuilderView();
  if (state.mode === "submit") renderSubmitView();
}

async function init() {
  [state.territorios, state.coplas, state.pezas, state.media] = await Promise.all([
    getTerritorios(),
    getCoplas(),
    getPezas(),
    getMedia(),
  ]);

  state.map = L.map("archive-map", { zoomControl: false, attributionControl: true }).setView([42.8, -8.2], 8);
  L.control.zoom({ position: "bottomleft" }).addTo(state.map);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: "&copy; OpenStreetMap contributors",
  }).addTo(state.map);

  $("#map-layer").addEventListener("change", event => loadLayer(event.target.value));
  $("#global-search").addEventListener("input", event => renderSearch(event.target.value));
  $("#global-search").addEventListener("keydown", event => {
    if (event.key !== "Enter") return;
    const first = searchTerritories(state.territorios, event.target.value)[0];
    if (first) selectTerritory(first, { switchMode: true });
  });
  $("#collapse-workbench").addEventListener("click", () => {
    state.workbenchCollapsed = !state.workbenchCollapsed;
    if (state.workbenchCollapsed) state.workbenchFocused = false;
    syncWorkbenchChrome();
  });
  $("#focus-workbench").addEventListener("click", () => {
    state.workbenchFocused = !state.workbenchFocused;
    if (state.workbenchFocused) state.workbenchCollapsed = false;
    syncWorkbenchChrome();
  });
  document.addEventListener("click", event => {
    const tab = event.target.closest("[data-mode]");
    if (tab) setMode(tab.dataset.mode);
  });

  await loadLayer("con");
  const params = new URL(window.location.href).searchParams;
  const territoryId = params.get("territory_id") || params.get("id");
  const coplaId = params.get("copla_id");
  const initialMode = params.get("mode");
  if (coplaId) {
    state.selectedCoplaId = Number(coplaId);
    setMode("corpus");
    return;
  }
  if (territoryId) {
    const territory = state.territorios.find(item => item.id === territoryId);
    if (territory) {
      await selectTerritory(territory, { switchMode: initialMode !== "corpus" });
      if (initialMode && ["place", "corpus", "builder", "submit"].includes(initialMode)) {
        setMode(initialMode);
      }
      return;
    }
  }
  if (initialMode && ["place", "corpus", "builder", "submit"].includes(initialMode)) {
    setMode(initialMode);
    return;
  }
  renderActiveView();
}

init().catch(error => {
  $("#map-status-text").textContent = error.message;
  $("#place-view").innerHTML = `<div class="view-head"><h2>Erro ao cargar</h2><p class="quiet">${escapeHtml(error.message)}</p></div>`;
});
