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

const RHYTHMS = [
  "Carballesa",
  "Charrasquiño",
  "Chiqui-chiqui",
  "Danza",
  "Dous pasos",
  "Esparabán",
  "Fandango",
  "Maneo",
  "Mazurca",
  "Muiñeira",
  "Muiñeira corrida",
  "Pandeirada",
  "Pasodobre",
  "Polca",
  "Ribeirana",
  "Rumba",
  "Valse",
  "Xota",
].sort((a, b) => a.localeCompare(b, "gl"));
const MUSICAL_MEDIA_KINDS = new Set(["audio", "spotify", "soundcloud"]);
const DRAFT_KEY = "fol-e-ar-piece-cart-v2";
const BATCH_KEY = "fol-e-ar-submit-v1";
const VIEWS = ["map", "coplas", "pieces", "territory", "submit", "media", "about"];

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
  miniMap: null,
  miniLayer: null,
  view: "map",
  territoryTab: "summary",
  coplaViewMode: "gallery",
  pieceTab: "library",
  coplaQuery: "",
  coplaStateFilter: "all",
  territoryQuery: "",
  pieceLibraryQuery: "",
  pieceTerritoryQuery: "",
  pieceRepositoryQuery: "",
  pieceRhythmQuery: "",
  mediaQuery: "",
  mediaKindFilter: "",
  mediaRoleFilter: "",
  mediaModalOpen: false,
  mediaDefaultRole: "",
  aboutTerritoryQuery: "",
  aboutTerritoryId: "",
  submitTerritoryId: "",
  submitTerritoryIds: [],
  mediaTerritoryIds: [],
  pdfUrl: "",
  pdfFilename: "",
  pdfBusy: false,
};

const $ = (selector, root = document) => root.querySelector(selector);
const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));
const memoryStore = new Map();

function storageGet(key) {
  try {
    return window.localStorage?.getItem(key) ?? memoryStore.get(key) ?? null;
  } catch {
    return memoryStore.get(key) ?? null;
  }
}

function storageSet(key, value) {
  memoryStore.set(key, value);
  try {
    window.localStorage?.setItem(key, value);
  } catch {
    // Keep the current session usable when browser storage is unavailable.
  }
}

if (window.FOL_E_AR_FILE_MODE) {
  throw new Error("Fol e ar debe abrirse desde o servidor local, non con file://.");
}

function normalizeView(view = "map") {
  const aliases = {
    place: "map",
    lugar: "map",
    mapa: "map",
    corpus: "coplas",
    copla: "coplas",
    pezas: "pieces",
    builder: "pieces",
    obradoiro: "pieces",
    alta: "submit",
    importar: "submit",
    territorios: "territory",
  };
  return aliases[view] || (VIEWS.includes(view) ? view : "map");
}

function defaultDraft() {
  return {
    title: "",
    author: "",
    territoryId: "",
    sections: [
      { id: "parte-1", label: "", coplas: [] },
    ],
  };
}

function loadDraft() {
  try {
    const raw = JSON.parse(storageGet(DRAFT_KEY));
    if (!raw || typeof raw !== "object") return defaultDraft();
    const base = defaultDraft();
    const sections = Array.isArray(raw.sections) && raw.sections.length ? raw.sections : base.sections;
    return {
      ...base,
      ...raw,
      sections: sections.map(section => ({
        ...section,
        coplas: (section.coplas || []).map(item => ({ ...item, uid: item.uid || `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2)}` })),
      })),
    };
  } catch {
    return defaultDraft();
  }
}

function saveDraft(draft) {
  storageSet(DRAFT_KEY, JSON.stringify(draft));
  updateCartBadges(draft);
  return draft;
}

function draftCount(draft = loadDraft()) {
  return draft.sections.reduce((sum, section) => sum + section.coplas.length, 0);
}

function updateCartBadges(draft = loadDraft()) {
  const total = draftCount(draft);
  all("[data-cart-count]").forEach(badge => {
    badge.textContent = total;
    badge.hidden = total === 0;
  });
}

function loadBatch() {
  try {
    const raw = JSON.parse(storageGet(BATCH_KEY));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function saveBatch(batch) {
  storageSet(BATCH_KEY, JSON.stringify(batch));
  return batch;
}

function topoToGeo(data) {
  if (data?.type !== "Topology" || !window.topojson) return data;
  const objectName = Object.keys(data.objects || {})[0];
  return window.topojson.feature(data, data.objects[objectName]);
}

async function geoLayerForMap(type) {
  let data = topoToGeo(await getGeoLayer(type));
  if (type !== "com") return data;
  data = {
    ...data,
    features: (data.features || []).filter(feature => Number(feature?.properties?.CODCOM) !== 0),
  };
  const parts = await getGeoLayer("cerdedoCotobadeParts");
  return { ...data, features: [...data.features, ...(parts.features || [])] };
}

function territoryLabel(territory) {
  return territory ? (TYPE_LABELS[territory.tipo] || territory.tipo || "Territorio") : "Territorio";
}

function parentCouncil(territory) {
  if (!territory || territory.tipo !== "par") return null;
  return state.territorios.find(item => item.tipo === "con" && item.cod === territory.con) || null;
}

function territorySearchMeta(territory) {
  const council = parentCouncil(territory);
  return council ? `${territoryLabel(territory)} · ${council.nome}` : territoryLabel(territory);
}

function territoryDisplayName(territory) {
  const council = parentCouncil(territory);
  return council ? `${territory.nome} · ${council.nome}` : territory.nome;
}

function coplaPlaceLabel(copla) {
  if ((copla.territories || []).length) return copla.territories.map(item => territoryDisplayName(item)).join(", ");
  if (copla.territory_state === "general") return "Galiza xeral";
  if (copla.territory_state === "unassigned") return "Lugar descoñecido";
  return "Sen territorio";
}

function placeContext(territory = state.selectedTerritory) {
  if (!territory) {
    return {
      hierarchy: [],
      children: state.territorios.filter(item => item.tipo === "prov"),
      descendantIds: state.territorios.map(item => item.id),
      coplas: state.coplas,
      pezas: state.pezas,
      media: state.media,
    };
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

function coplaHaystack(copla) {
  return [
    copla.text,
    copla.incipit,
    copla.notes,
    copla.territory_state,
    coplaPlaceLabel(copla),
    (copla.tags || []).join(" "),
    (copla.versions || []).map(version => `${version.label || ""} ${version.text || ""} ${version.notes || ""}`).join(" "),
  ].join(" ");
}

function firstLine(text = "") {
  return String(text).split(/\r?\n/).find(line => line.trim())?.trim() || "";
}

function coplaTitle(copla) {
  return firstLine(copla.text) || copla.incipit || "Copla sen íncipit";
}

function mediaUrl(item) {
  return item.url || item.href || item.link || "";
}

function mediaKind(item) {
  const explicit = normalizeText(item.media_kind || item.type || item.provider || item.kind || "");
  const url = mediaUrl(item).toLowerCase();
  if (explicit.includes("spotify") || url.includes("open.spotify.com")) return "spotify";
  if (explicit.includes("youtube") || url.includes("youtu.be") || url.includes("youtube.com")) return "youtube";
  if (explicit.includes("soundcloud") || url.includes("soundcloud.com")) return "soundcloud";
  if (explicit.includes("audio") || /\.(mp3|wav|ogg|m4a)(\?|#|$)/.test(url)) return "audio";
  if (explicit.includes("video") || /\.(mp4|mov|webm)(\?|#|$)/.test(url)) return "video";
  if (explicit.includes("imaxe") || explicit.includes("image") || /\.(png|jpe?g|gif|webp|avif)(\?|#|$)/.test(url)) return "image";
  return url ? "web" : "media";
}

function mediaRole(item) {
  const relationTypes = (item.links || []).map(link => normalizeText(link.relation_type || ""));
  if (relationTypes.includes("mixed") || relationTypes.includes("ambas")) return "mixed";
  if (relationTypes.includes("melody") || relationTypes.includes("melodia")) return "melody";
  if (relationTypes.includes("documental") || relationTypes.includes("direct")) {
    return MUSICAL_MEDIA_KINDS.has(mediaKind(item)) ? "melody" : "documental";
  }
  return MUSICAL_MEDIA_KINDS.has(mediaKind(item)) ? "melody" : "documental";
}

function mediaRoleLabel(role) {
  return {
    documental: "Documental",
    melody: "Melodía",
    mixed: "Media + melodía",
  }[role] || "Media";
}

function mediaLabel(kind) {
  return {
    spotify: "Spotify",
    youtube: "YouTube",
    soundcloud: "SoundCloud",
    audio: "Audio",
    video: "Video",
    image: "Imaxe",
    web: "Web",
    media: "Media",
  }[kind] || "Media";
}

function youtubeId(url = "") {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.includes("youtu.be")) return parsed.pathname.slice(1);
    if (parsed.searchParams.get("v")) return parsed.searchParams.get("v");
    const match = parsed.pathname.match(/\/(embed|shorts)\/([^/?]+)/);
    return match?.[2] || "";
  } catch {
    return "";
  }
}

function mediaCard(item) {
  const url = mediaUrl(item);
  const kind = mediaKind(item);
  const title = item.title || item.label || item.name || "Recurso sen título";
  const description = item.description || item.notes || item.artist || item.context || "";
  const role = mediaRole(item);
  const territoryLinks = mediaTerritories(item).map(territory => territory.nome);
  const yt = kind === "youtube" ? youtubeId(url) : "";
  let preview = `<div class="media-preview is-${kind}"><span>${escapeHtml(mediaLabel(kind))}</span></div>`;
  if (item.thumbnail_url) preview = `<img class="media-preview" src="${escapeHtml(item.thumbnail_url)}" alt="">`;
  if (kind === "image" && url) preview = `<img class="media-preview" src="${escapeHtml(url)}" alt="">`;
  if (kind === "youtube" && yt) preview = `<img class="media-preview" src="https://img.youtube.com/vi/${escapeHtml(yt)}/hqdefault.jpg" alt="">`;
  if (kind === "audio" && url) preview = `<div class="media-preview is-audio"><span>Audio</span><audio controls src="${escapeHtml(url)}"></audio></div>`;
  if (kind === "video" && url) preview = `<video class="media-preview" controls src="${escapeHtml(url)}"></video>`;
  return `
    <article class="media-card" tabindex="${url ? "0" : "-1"}" role="${url ? "link" : "article"}" data-open-media="${escapeHtml(url)}" aria-label="${escapeHtml(title)}">
      ${preview}
      <div class="media-body">
        <div class="eyebrow">${escapeHtml(mediaLabel(kind))}</div>
        <h2>${escapeHtml(title)}</h2>
        ${description ? `<p>${escapeHtml(description)}</p>` : ""}
        <div class="meta">
          <span class="tag">${escapeHtml(mediaRoleLabel(role))}</span>
          ${territoryLinks.length ? `<span class="tag place">${escapeHtml(territoryLinks.slice(0, 2).join(" · "))}</span>` : ""}
        </div>
        ${url ? "" : `<p class="muted">Sen ligazón pública.</p>`}
      </div>
    </article>
  `;
}

function mediaTerritories(item) {
  return (item.links || [])
    .filter(link => link.entity_type === "territory")
    .map(link => state.territorios.find(territory => territory.id === link.entity_id))
    .filter(Boolean);
}

function bindMediaCards(root = document) {
  all("[data-open-media]", root).forEach(card => {
    if (card.dataset.boundMediaCard) return;
    card.dataset.boundMediaCard = "true";
    const open = event => {
      if (event?.target?.closest?.("audio, video, button, input, select, textarea")) return;
      const url = card.dataset.openMedia;
      if (url) window.open(url, "_blank", "noopener");
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        open(event);
      }
    });
  });
}

function setView(viewName) {
  state.view = normalizeView(viewName);
  all(".view").forEach(view => view.classList.toggle("active", view.id === `view-${state.view}`));
  all("[data-view]").forEach(button => button.classList.toggle("active", normalizeView(button.dataset.view) === state.view));
  renderView();
  if (state.view === "map" && state.map) window.setTimeout(() => state.map.invalidateSize(), 120);
}

function clearTerritory() {
  state.selectedTerritory = null;
  state.selectedCoplaId = null;
  state.territoryTab = "summary";
  $("#mapSearch").value = "";
  $("#mapResults").innerHTML = "";
  updateMapCard();
  state.layer?.eachLayer(layer => layer.setStyle(styleFeature(false)));
  if (state.layer) {
    try {
      state.map.fitBounds(state.layer.getBounds(), { padding: [24, 24] });
    } catch {}
  }
  if (state.view === "territory") renderTerritoryView();
  if (state.view === "coplas") renderCoplasView();
}

function styleFeature(selected = false, fragment = false) {
  const base = selected
    ? { weight: 2.5, color: "#f6f7f4", fillColor: "#315f4b", fillOpacity: 0.62 }
    : { weight: 1, color: "#315f4b", fillColor: "#8ca99b", fillOpacity: 0.22 };
  return fragment ? { ...base, weight: selected ? 2.2 : 1.2, dashArray: "3 3" } : base;
}

async function loadLayer(type = state.layerType) {
  state.layerType = type;
  const layerSelect = $("#mapLayer");
  if (layerSelect) layerSelect.value = type;
  if (!state.map || !window.L) return;
  if (state.layer) state.layer.remove();
  let data = await geoLayerForMap(type);
  state.layer = L.geoJSON(data, {
    style: feature => {
      const territory = findTerritoryByFeature(feature, type, state.territorios);
      return styleFeature(territory?.id === state.selectedTerritory?.id, Boolean(feature?.properties?.part));
    },
    onEachFeature(feature, layer) {
      const territory = findTerritoryByFeature(feature, type, state.territorios);
      const part = feature?.properties?.part;
      const name = part ? `${feature.properties.COMARCA} · ${part}` : territory?.nome || getFeatureNome(feature, type);
      layer.bindTooltip(name, { sticky: true, direction: "auto" });
      layer.on("mouseover", () => {
        if (part) layer.setStyle({ weight: 2, fillOpacity: 0.4 });
        else if (territory?.id !== state.selectedTerritory?.id) layer.setStyle({ weight: 2, fillOpacity: 0.4 });
      });
      layer.on("mouseout", () => state.layer?.resetStyle(layer));
      layer.on("click", () => {
        if (territory) selectTerritory(territory, { fit: false, openCard: true });
      });
    },
  }).addTo(state.map);
  try {
    state.map.fitBounds(state.layer.getBounds(), { padding: [24, 24] });
  } catch {}
}

async function selectTerritory(territory, options = {}) {
  state.selectedTerritory = territory;
  if (territory.tipo !== state.layerType) {
    await loadLayer(territory.tipo);
  }
  state.layer?.eachLayer(layer => {
    const found = findTerritoryByFeature(layer.feature, state.layerType, state.territorios);
    layer.setStyle(styleFeature(found?.id === territory.id, Boolean(layer.feature?.properties?.part)));
    if (found?.id === territory.id && options.fit !== false) {
      try {
        state.map.flyToBounds(layer.getBounds(), { padding: [40, 40], duration: 0.45 });
      } catch {}
    }
  });
  updateMapCard();
  if (state.view === "territory") renderTerritoryView();
  if (state.view === "coplas") renderCoplasView();
  if (options.openCard) updateMapCard();
}

function updateMapCard() {
  const territory = state.selectedTerritory;
  const ctx = placeContext(territory);
  const clearButton = $("#clearTerritory");
  if (clearButton) clearButton.hidden = !territory;
  const title = $("#mapCardTitle");
  const text = $("#mapCardText");
  const coplaCount = $("#mapCoplaCount");
  const pieceCount = $("#mapPieceCount");
  const territoryCount = $("#mapTerritoryCount");
  if (!title || !text || !coplaCount || !pieceCount || !territoryCount) return;
  title.textContent = territory?.nome || "Galiza";
  text.textContent = territory
    ? `${territoryLabel(territory)} con ${ctx.coplas.length} coplas asociadas, directas ou herdadas dos seus subterritorios.`
    : "Explora o corpus territorialmente ou emprega a busca para localizar unha parroquia, concello, copla ou peza.";
  coplaCount.textContent = territory ? ctx.coplas.length : state.coplas.length;
  pieceCount.textContent = territory ? ctx.pezas.length : state.pezas.length;
  territoryCount.textContent = territory ? ctx.children.length : state.territorios.length;
}

function setMapCardCollapsed(collapsed) {
  const card = $(".map-card");
  const toggle = $("#mapCardToggle");
  if (!card || !toggle) return;
  card.classList.toggle("is-collapsed", collapsed);
  toggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
  toggle.textContent = collapsed ? "Mostrar información" : "Ocultar información";
}

function renderMapSearch(query = "") {
  const results = $("#mapResults");
  const q = query.trim();
  if (!q) {
    results.innerHTML = "";
    return;
  }
  const territoryHits = searchTerritories(state.territorios, q).slice(0, 7);
  const textQ = normalizeText(q);
  const coplaHits = state.coplas.filter(copla => normalizeText(coplaHaystack(copla)).includes(textQ)).slice(0, 5);
  results.innerHTML = `
    ${territoryHits.map(item => `
      <button type="button" data-territory-id="${item.id}">
        <strong>${escapeHtml(item.nome)}</strong>
        <span>${escapeHtml(territorySearchMeta(item))}</span>
      </button>
    `).join("")}
    ${coplaHits.map(item => `
      <button class="result-copla" type="button" data-copla-id="${item.id}">
        <strong>${escapeHtml(coplaTitle(item))}</strong>
        <span>Copla</span>
      </button>
    `).join("")}
    ${!territoryHits.length && !coplaHits.length ? `<p class="muted">Sen resultados.</p>` : ""}
  `;
  bindResultButtons(results);
}

function bindResultButtons(root = document) {
  all("[data-territory-id]", root).forEach(button => {
    button.addEventListener("click", () => {
      const territory = state.territorios.find(item => item.id === button.dataset.territoryId);
      if (territory) {
        if (button.closest("#territorySearchResults")) state.territoryQuery = "";
        closeCoplaDrawer();
        selectTerritory(territory);
        setView("territory");
      }
    });
  });
  all("[data-copla-id]", root).forEach(button => {
    button.addEventListener("click", () => {
      state.selectedCoplaId = Number(button.dataset.coplaId);
      setView("coplas");
      openCoplaDrawer(state.selectedCoplaId);
    });
  });
}

function coplaCard(copla, options = {}) {
  const versionCount = (copla.versions || []).length;
  return `
    <article class="gallery-card ${options.list ? "as-list" : ""}" tabindex="0" role="button" data-open-copla="${copla.id}">
      <div>
        <div class="gallery-top">
          <span class="gallery-place">${escapeHtml(coplaPlaceLabel(copla))}</span>
          <button class="mini-add icon-add" type="button" data-add-copla="${copla.id}" aria-label="Engadir á peza">+</button>
        </div>
        <h2 class="gallery-title">${escapeHtml(coplaTitle(copla))}</h2>
        <div class="gallery-text">${nl2br(copla.text || "")}</div>
      </div>
      <div class="gallery-bottom">
        <div class="meta">
          <span class="tag">${versionCount ? `${versionCount} variantes` : "texto único"}</span>
        </div>
      </div>
    </article>
  `;
}

function filteredCoplas() {
  const scoped = state.selectedTerritory ? placeContext().coplas : state.coplas;
  const q = normalizeText(state.coplaQuery);
  return scoped.filter(copla => {
    const stateMatches = state.coplaStateFilter === "all" || copla.territory_state === state.coplaStateFilter;
    return stateMatches && (!q || normalizeText(coplaHaystack(copla)).includes(q));
  });
}

function coplaStreamClass() {
  return state.coplaViewMode === "list" ? "copla-list" : "copla-gallery gallery-wide";
}

function updateCoplasResults(root = $("#view-coplas")) {
  const items = filteredCoplas();
  const list = $("#coplaList", root);
  const count = $("#coplaResultCount", root);
  const scope = $("#coplaResultScope", root);
  if (count) count.textContent = `Mostrando ${items.length} coplas`;
  if (scope) scope.textContent = state.selectedTerritory ? "inclúe subterritorios" : "arquivo completo";
  if (list) {
    list.className = coplaStreamClass();
    list.innerHTML = items.map(copla => coplaCard(copla, { list: state.coplaViewMode === "list" })).join("") || `<p class="muted">Sen coplas para esta consulta.</p>`;
    bindCoplaActions(list);
  }
  all("[data-copla-view]", root).forEach(button => button.classList.toggle("active", button.dataset.coplaView === state.coplaViewMode));
  all("[data-state-filter]", root).forEach(button => button.classList.toggle("active", button.dataset.stateFilter === state.coplaStateFilter));
  const allChip = $("[data-copla-total]", root);
  if (allChip) {
    allChip.textContent = `Todas · ${items.length}`;
    allChip.classList.toggle("active", state.coplaStateFilter === "all");
  }
}

function renderCoplasView() {
  const view = $("#view-coplas");
  const items = filteredCoplas();
  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Corpus</div>
          <h1>${state.selectedTerritory ? `Coplas de ${escapeHtml(state.selectedTerritory.nome)}` : "Coplas"}</h1>
          <p>Consulta transversal do repertorio. A lista serve para ler rápido; a galería abre unha lectura máis pausada.</p>
        </div>
        <button class="btn primary" type="button" data-view="submit">+ Nova copla</button>
      </div>
      <div class="toolbar">
        <div class="searchbox"><span>⌕</span><input id="coplaSearch" type="search" value="${escapeHtml(state.coplaQuery)}" placeholder="Buscar por verso, íncipit, territorio..."></div>
        <select id="coplaScope">
          <option value="current" ${state.selectedTerritory ? "selected" : ""}>Ámbito actual</option>
          <option value="all" ${state.selectedTerritory ? "" : "selected"}>Todo o corpus</option>
        </select>
        <div class="view-toggle">
          <button class="chip ${state.coplaViewMode === "list" ? "active" : ""}" type="button" data-copla-view="list">Lista</button>
          <button class="chip ${state.coplaViewMode === "gallery" ? "active" : ""}" type="button" data-copla-view="gallery">Galería</button>
        </div>
      </div>
      <div class="chips">
        <button class="chip ${state.coplaStateFilter === "all" ? "active" : ""}" type="button" data-copla-total data-state-filter="all">Todas · ${items.length}</button>
        <button class="chip ${state.coplaStateFilter === "assigned" ? "active" : ""}" type="button" data-state-filter="assigned">Asignadas</button>
        <button class="chip ${state.coplaStateFilter === "general" ? "active" : ""}" type="button" data-state-filter="general">Galiza xeral</button>
      </div>
      <div class="results-row"><span id="coplaResultCount" class="muted">Mostrando ${items.length} coplas</span><span id="coplaResultScope" class="muted">${state.selectedTerritory ? "inclúe subterritorios" : "arquivo completo"}</span></div>
      <div id="coplaList" class="${coplaStreamClass()}">
        ${items.map(copla => coplaCard(copla, { list: state.coplaViewMode === "list" })).join("") || `<p class="muted">Sen coplas para esta consulta.</p>`}
      </div>
    </div>
  `;
  $("#coplaSearch")?.addEventListener("input", event => {
    state.coplaQuery = event.target.value;
    updateCoplasResults(view);
  });
  $("#coplaScope")?.addEventListener("change", event => {
    if (event.target.value === "all") state.selectedTerritory = null;
    renderCoplasView();
  });
  all("[data-copla-view]", view).forEach(button => button.addEventListener("click", () => {
    state.coplaViewMode = button.dataset.coplaView;
    updateCoplasResults(view);
  }));
  all("[data-state-filter]", view).forEach(button => button.addEventListener("click", () => {
    state.coplaStateFilter = button.dataset.stateFilter;
    updateCoplasResults(view);
  }));
  bindCoplaActions(view);
}

function bindCoplaActions(root = document) {
  bindResultButtons(root);
  all("[data-open-copla]", root).forEach(card => {
    card.addEventListener("click", event => {
      if (event.target.closest("button, a, select, input, textarea")) return;
      openCoplaDrawer(Number(card.dataset.openCopla));
    });
    card.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openCoplaDrawer(Number(card.dataset.openCopla));
      }
    });
  });
  all("[data-add-copla]", root).forEach(button => button.addEventListener("click", event => {
    event.stopPropagation();
    const copla = state.coplas.find(item => Number(item.id) === Number(button.dataset.addCopla));
    if (!copla) return;
    const draft = loadDraft();
    if (state.selectedTerritory && !draft.territoryId) draft.territoryId = state.selectedTerritory.id;
    if (state.selectedTerritory && !draft.title) draft.title = territoryContextTitle(state.selectedTerritory);
    draft.sections[0].coplas.push({
      uid: `${copla.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      id: copla.id,
      incipit: copla.incipit || "",
      text: copla.text || "",
      territory: coplaPlaceLabel(copla),
      role: "copla",
    });
    saveDraft(draft);
    const original = button.dataset.originalText || button.textContent;
    button.dataset.originalText = original;
    button.textContent = original.trim() === "+" ? "+" : "Engadida";
    button.classList.add("is-added");
    window.setTimeout(() => {
      button.textContent = button.dataset.originalText;
      button.classList.remove("is-added");
    }, 1000);
    if (state.view === "pieces" && state.pieceTab === "workshop") {
      renderPiecesView();
    }
  }));
}

function openCoplaDrawer(coplaId) {
  const copla = state.coplas.find(item => Number(item.id) === Number(coplaId));
  const drawer = $("#coplaDrawer");
  if (!copla || !drawer) return;
  const territories = (copla.territories || []);
  drawer.hidden = false;
  drawer.innerHTML = `
    <div class="drawer-scrim" data-close-drawer></div>
    <aside class="drawer-panel" role="dialog" aria-modal="true" aria-label="Ficha da copla">
      <button class="card-close" type="button" data-close-drawer aria-label="Pechar">×</button>
      <div class="eyebrow">Ficha textual</div>
      <h2>${escapeHtml(coplaTitle(copla))}</h2>
      <div class="gallery-text">${nl2br(copla.text || "")}</div>
      <div class="drawer-section">
        <h3>Territorio</h3>
        <div class="territory-links">
          ${territories.map(item => `
            <button type="button" data-territory-id="${item.id}">
              <strong>${escapeHtml(item.nome)}</strong>
              <span>${escapeHtml(territorySearchMeta(item))}</span>
            </button>
          `).join("") || `<p class="muted">${escapeHtml(coplaPlaceLabel(copla))}</p>`}
        </div>
      </div>
      <div class="drawer-section">
        <h3>Variantes</h3>
        ${(copla.versions || []).map(version => `
          <div class="variant">
            <strong>${escapeHtml(version.label || version.incipit || "Variante")}</strong>
            <div>${nl2br(version.text || "")}</div>
            ${version.notes ? `<p class="muted">${escapeHtml(version.notes)}</p>` : ""}
          </div>
        `).join("") || `<p class="muted">Sen variantes rexistradas.</p>`}
      </div>
      <div class="drawer-section">
        <h3>Notas e fonte</h3>
        <p class="muted">${escapeHtml(copla.notes || "Sen notas rexistradas.")}</p>
      </div>
      <div class="meta">${(copla.tags || []).map(tag => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
      <button class="btn primary drawer-add" type="button" data-add-copla="${copla.id}" aria-label="Engadir á peza">+</button>
    </aside>
  `;
  all("[data-close-drawer]", drawer).forEach(item => item.addEventListener("click", closeCoplaDrawer));
  bindResultButtons(drawer);
  bindCoplaActions(drawer);
}

function closeCoplaDrawer() {
  const drawer = $("#coplaDrawer");
  if (!drawer) return;
  drawer.hidden = true;
  drawer.innerHTML = "";
}

function pieceTerritory() {
  const draft = loadDraft();
  return state.territorios.find(item => item.id === draft.territoryId) || state.selectedTerritory || null;
}

function territoryContextTitle(territory) {
  if (!territory) return "";
  const hierarchy = buildHierarchy(territory, state.territorios);
  const parentConcello = hierarchy.find(item => item.tipo === "con" && item.id !== territory.id);
  if (territory.tipo === "par" && parentConcello) return `${territory.nome} - ${parentConcello.nome}`;
  const parentComarca = hierarchy.find(item => item.tipo === "com" && item.id !== territory.id);
  if (territory.tipo === "con" && parentComarca) return territory.nome;
  return territory.nome;
}

function filteredPieceLibrary() {
  const territory = pieceTerritory();
  const scoped = territory ? filterCoplasByTerritory(state.coplas, getDescendantIds(territory, state.territorios)) : state.coplas;
  const q = normalizeText(state.pieceLibraryQuery);
  return scoped.filter(copla => !q || normalizeText(coplaHaystack(copla)).includes(q)).slice(0, 80);
}

function pieceHaystack(piece) {
  return [
    piece.title,
    piece.titulo,
    piece.author,
    piece.autoria,
    piece.description,
    piece.notes,
    piece.context,
    piece.territory_id,
    piece.context_territory_id,
  ].join(" ");
}

function filteredPieceRepository() {
  const territory = pieceTerritory();
  const scoped = territory ? filterPiecesByTerritory(state.pezas, getDescendantIds(territory, state.territorios), state.coplas) : state.pezas;
  const q = normalizeText(state.pieceRepositoryQuery);
  const rhythm = normalizeText(state.pieceRhythmQuery);
  return scoped.filter(piece => {
    const matchesText = !q || normalizeText(pieceHaystack(piece)).includes(q);
    const sections = piece.sections || piece.parts || piece.coplas || [];
    const matchesRhythm = !rhythm || sections.some(item => normalizeText(item.label || item.section_label || item.rhythm || "").includes(rhythm));
    return matchesText && matchesRhythm;
  });
}

function pieceCard(piece) {
  const title = piece.title || piece.titulo || "Peza sen título";
  const author = piece.author || piece.autoria || piece.creator || "Sen autoría";
  const sections = piece.sections || piece.parts || [];
  const coplaTotal = sections.reduce((sum, section) => sum + (section.coplas || section.items || []).length, 0);
  return `
    <article class="piece-card">
      <div>
        <div class="eyebrow">Peza gardada</div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(piece.description || piece.notes || "Mapa de referencias de coplas preparado para consulta e exportación.")}</p>
      </div>
      <div class="meta">
        <span class="tag place">${escapeHtml(author)}</span>
        <span class="tag">${coplaTotal || piece.copla_count || 0} coplas</span>
        ${sections.length ? `<span class="tag">${sections.length} partes</span>` : ""}
      </div>
    </article>
  `;
}

function renderPieceTerritoryResults(root = $("#view-pieces")) {
  const results = $("#pieceTerritoryResults", root);
  if (!results) return;
  const query = state.pieceTerritoryQuery.trim();
  if (!query) {
    results.innerHTML = "";
    return;
  }
  const matches = searchTerritories(state.territorios, query).slice(0, 10);
  results.innerHTML = matches.map(item => `
    <button type="button" data-piece-territory="${item.id}">
      <strong>${escapeHtml(item.nome)}</strong>
      <span>${escapeHtml(territorySearchMeta(item))}</span>
    </button>
  `).join("") || `<p class="muted">Sen resultados.</p>`;
  all("[data-piece-territory]", results).forEach(button => button.addEventListener("click", async () => {
    const territory = state.territorios.find(item => item.id === button.dataset.pieceTerritory);
    if (!territory) return;
    const draft = loadDraft();
    draft.territoryId = territory.id;
    if (!draft.title) draft.title = territoryContextTitle(territory);
    saveDraft(draft);
    state.pieceTerritoryQuery = "";
    await selectTerritory(territory);
    renderPiecesView();
  }));
}

function updatePieceLibrary(root = $("#view-pieces")) {
  const library = filteredPieceLibrary();
  const list = $("#pieceLibraryList", root);
  const count = $("#pieceLibraryCount", root);
  if (count) count.textContent = `${library.length} coplas`;
  if (!list) return;
  list.innerHTML = library.map(copla => `
    <article class="mini-copla">
      <h3>${escapeHtml(coplaTitle(copla))}</h3>
      <p>${nl2br(copla.text || "")}</p>
      <div class="mini-bottom">
        <span class="tag place">${escapeHtml(coplaPlaceLabel(copla))}</span>
        <button class="mini-add" type="button" data-add-copla="${copla.id}">+</button>
      </div>
    </article>
  `).join("") || `<p class="muted">Sen coplas no repertorio.</p>`;
  bindCoplaActions(list);
}

function updatePieceRepository(root = $("#view-pieces")) {
  const repo = filteredPieceRepository();
  const list = $("#pieceRepositoryList", root);
  const count = $("#pieceRepositoryCount", root);
  if (count) count.textContent = `${repo.length} pezas`;
  if (!list) return;
  list.innerHTML = repo.map(pieceCard).join("") || `<article class="panel empty-panel"><p class="muted">Aínda non hai pezas gardadas neste ámbito. Cando se publique unha peza, aparecerá aquí como mapa de referencias.</p></article>`;
}

function renderPiecesView() {
  const view = $("#view-pieces");
  const draft = loadDraft();
  const library = filteredPieceLibrary();
  const repo = filteredPieceRepository();
  const total = draftCount(draft);
  const territory = pieceTerritory();
  const rhythmOptions = `<option value="">Seleccionar ritmo</option>${RHYTHMS.map(value => `<option value="${value}">${value}</option>`).join("")}`;
  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Pezas</div>
          <h1>${state.pieceTab === "workshop" ? "Obradoiro" : "Biblioteca de pezas"}</h1>
          <p>${state.pieceTab === "workshop" ? "Engade coplas mentres exploras e constrúe aquí unha peza con partes, ritmo, orde e saída para canto." : "Repositorio de pezas publicadas ou gardadas como mapas de coplas, filtrábeis por territorio, creador e ritmo."}</p>
        </div>
        ${state.pieceTab === "workshop" ? `
          <div class="header-actions">
            <button class="btn" type="button" id="clearPiece">Baleirar</button>
            <button class="btn" type="button" id="savePieceDirect">Gardar peza</button>
            <button class="btn" type="button" id="downloadPiece">Descargar estrutura</button>
            <button class="btn primary" type="button" id="openA4" ${state.pdfBusy ? "disabled" : ""}>${state.pdfBusy ? "Xerando PDF..." : "Exportar PDF"}</button>
          </div>
        ` : ""}
      </div>
      <div class="section-tabs piece-tabs">
        <button class="${state.pieceTab === "library" ? "active" : ""}" type="button" data-piece-tab="library">Biblioteca</button>
        <button class="${state.pieceTab === "workshop" ? "active" : ""}" type="button" data-piece-tab="workshop">Obradoiro <b class="cart-count" data-cart-count ${total ? "" : "hidden"}>${total}</b></button>
      </div>
      ${state.pieceTab === "library" ? `
        <section class="panel piece-repository">
          <div class="section-title"><h2>Pezas gardadas</h2><span id="pieceRepositoryCount" class="muted">${repo.length} pezas</span></div>
          <div class="toolbar piece-filters">
            <div class="searchbox"><span>⌕</span><input id="pieceRepositorySearch" type="search" value="${escapeHtml(state.pieceRepositoryQuery)}" placeholder="Buscar por título, creador ou contexto..."></div>
            <select id="pieceRhythmFilter" aria-label="Filtrar por ritmo">
              <option value="">Todos os ritmos</option>
              ${RHYTHMS.map(value => `<option value="${value}" ${state.pieceRhythmQuery === value ? "selected" : ""}>${value}</option>`).join("")}
            </select>
          </div>
          <div id="pieceRepositoryList" class="piece-grid">
            ${repo.map(pieceCard).join("") || `<article class="panel empty-panel"><p class="muted">Aínda non hai pezas gardadas neste ámbito. Cando se publique unha peza, aparecerá aquí como mapa de referencias.</p></article>`}
          </div>
        </section>
        <section class="panel creator-note">
          <div>
            <div class="eyebrow">Creadoras e artistas</div>
            <h2>Preparado para perfís</h2>
            <p class="muted">A biblioteca xa reserva a lóxica de autoría/creador. O seguinte paso natural será normalizar artistas nunha táboa propia e facer fichas clicábeis con pezas, media e repertorio asociado.</p>
          </div>
        </section>
      ` : `
        <div id="pieceExportStatus" class="export-status" role="status" aria-live="polite"></div>
        <div class="toolbar piece-scopebar">
          <div class="searchbox"><span>⌕</span><input id="pieceTerritorySearch" type="search" value="${escapeHtml(state.pieceTerritoryQuery)}" placeholder="Centrar peza nun territorio..."></div>
          ${territory ? `<button class="btn" type="button" id="clearPieceTerritory">Limpar territorio: ${escapeHtml(territory.nome)}</button>` : `<span class="muted">Sen territorio de traballo.</span>`}
        </div>
        <div id="pieceTerritoryResults" class="territory-results compact"></div>
        <div class="piece-layout">
          <section class="panel">
            <div class="section-title"><h2>Repertorio</h2><span id="pieceLibraryCount" class="muted">${library.length} coplas</span></div>
            <div class="toolbar"><div class="searchbox"><span>⌕</span><input id="pieceSearch" type="search" value="${escapeHtml(state.pieceLibraryQuery)}" placeholder="Buscar coplas para engadir..."></div></div>
            <div id="pieceLibraryList" class="library-list">
              ${library.map(copla => `
                <article class="mini-copla">
                  <h3>${escapeHtml(coplaTitle(copla))}</h3>
                  <p>${nl2br(copla.text || "")}</p>
                  <div class="mini-bottom">
                    <span class="tag place">${escapeHtml(coplaPlaceLabel(copla))}</span>
                    <button class="mini-add" type="button" data-add-copla="${copla.id}">+</button>
                  </div>
                </article>
              `).join("") || `<p class="muted">Sen coplas no repertorio.</p>`}
            </div>
          </section>
          <section class="piece-editor">
            <div class="cart-kpi"><strong>${total}</strong><span>coplas no carriño${territory ? ` · ${escapeHtml(territory.nome)}` : ""}</span></div>
            <div class="formgrid">
              <div class="field full"><label>Título da peza</label><input id="pieceTitle" type="text" value="${escapeHtml(draft.title || territoryContextTitle(territory) || "")}" placeholder="Foliada de Malpica"></div>
              <div class="field"><label>Autoría / creador</label><input id="pieceAuthor" type="text" value="${escapeHtml(draft.author || "")}" placeholder="Nome"></div>
              <div class="field"><label>Estado</label><select><option>Borrador</option><option>Revisada</option><option>Publicada</option></select></div>
            </div>
            <div class="sequence">
              <div class="sequence-head"><div><div class="eyebrow">Estrutura</div><h2>Partes e ritmos</h2></div><button class="btn" type="button" id="addSection">Engadir parte</button></div>
              <div class="builder-sections">
                ${draft.sections.map(section => `
                  <article class="builder-section" data-section-id="${section.id}">
                    <div class="section-line">
                      <select data-section-label="${section.id}" aria-label="Ritmo da parte">${rhythmOptions}</select>
                      <button class="icon-trash" type="button" data-remove-section="${section.id}" aria-label="Eliminar parte">🗑</button>
                    </div>
                    <div class="sequence-list" data-drop-section="${section.id}">
                      ${section.coplas.map(item => `
                        <article class="seq-item" draggable="true" data-drag-copla="${escapeHtml(item.uid || item.id)}" data-section="${section.id}">
                          <div class="drag">☷</div>
                          <div>
                            <div class="seq-text">${escapeHtml(item.incipit || firstLine(item.text) || "Copla sen íncipit")}</div>
                            <div class="seq-preview">${nl2br(item.text || "")}</div>
                            <div class="meta"><span class="tag place">${escapeHtml(item.territory || "")}</span></div>
                          </div>
                          <div class="seq-tools">
                            <select aria-label="Tipo textual" data-item-role="${escapeHtml(item.uid || item.id)}">
                              <option value="copla" ${(item.role || "copla") === "copla" ? "selected" : ""}>Copla</option>
                              <option value="retrouso" ${item.role === "retrouso" ? "selected" : ""}>Retr. </option>
                            </select>
                            <button type="button" data-remove-cart="${escapeHtml(item.uid || item.id)}">×</button>
                          </div>
                        </article>
                      `).join("") || `<p class="muted">Engade coplas ou arrastra aquí desde outra parte.</p>`}
                    </div>
                  </article>
                `).join("")}
              </div>
            </div>
          </section>
        </div>
      `}
    </div>
  `;
  all("[data-piece-tab]", view).forEach(button => button.addEventListener("click", () => {
    state.pieceTab = button.dataset.pieceTab;
    renderPiecesView();
  }));
  draft.sections.forEach(section => {
    const select = $(`[data-section-label="${section.id}"]`, view);
    if (select) select.value = section.label;
  });
  $("#pieceSearch")?.addEventListener("input", event => {
    state.pieceLibraryQuery = event.target.value;
    updatePieceLibrary(view);
  });
  $("#pieceRepositorySearch")?.addEventListener("input", event => {
    state.pieceRepositoryQuery = event.target.value;
    updatePieceRepository(view);
  });
  $("#pieceRhythmFilter")?.addEventListener("change", event => {
    state.pieceRhythmQuery = event.target.value;
    updatePieceRepository(view);
  });
  $("#pieceTerritorySearch")?.addEventListener("input", event => {
    state.pieceTerritoryQuery = event.target.value;
    renderPieceTerritoryResults(view);
  });
  $("#clearPieceTerritory")?.addEventListener("click", () => {
    const next = loadDraft();
    next.territoryId = "";
    saveDraft(next);
    state.selectedTerritory = null;
    state.pieceTerritoryQuery = "";
    renderPiecesView();
  });
  $("#pieceTitle")?.addEventListener("input", event => saveDraft({ ...loadDraft(), title: event.target.value }));
  $("#pieceAuthor")?.addEventListener("input", event => saveDraft({ ...loadDraft(), author: event.target.value }));
  $("#addSection")?.addEventListener("click", () => {
    const next = loadDraft();
    next.sections.push({ id: `section-${Date.now()}`, label: "", coplas: [] });
    saveDraft(next);
    renderPiecesView();
  });
  $("#clearPiece")?.addEventListener("click", () => {
    saveDraft(defaultDraft());
    renderPiecesView();
  });
  $("#downloadPiece")?.addEventListener("click", () => {
    downloadText("peza.json", JSON.stringify(buildPiecePayload(), null, 2), "application/json");
  });
  $("#savePieceDirect")?.addEventListener("click", savePieceDirect);
  $("#openA4")?.addEventListener("click", exportPiecePdf);
  all("[data-section-label]", view).forEach(select => select.addEventListener("change", () => {
    const next = loadDraft();
    const section = next.sections.find(item => item.id === select.dataset.sectionLabel);
    if (section) section.label = select.value;
    saveDraft(next);
    renderPiecesView();
  }));
  all("[data-remove-section]", view).forEach(button => button.addEventListener("click", () => {
    const next = loadDraft();
    if (next.sections.length > 1) next.sections = next.sections.filter(item => item.id !== button.dataset.removeSection);
    saveDraft(next);
    renderPiecesView();
  }));
  all("[data-remove-cart]", view).forEach(button => button.addEventListener("click", () => {
    const next = loadDraft();
    next.sections.forEach(section => {
      section.coplas = section.coplas.filter(item => String(item.uid || item.id) !== String(button.dataset.removeCart));
    });
    saveDraft(next);
    renderPiecesView();
  }));
  all("[data-item-role]", view).forEach(select => select.addEventListener("change", () => {
    const next = loadDraft();
    next.sections.forEach(section => {
      section.coplas.forEach(item => {
        if (String(item.uid || item.id) === String(select.dataset.itemRole)) item.role = select.value;
      });
    });
    saveDraft(next);
  }));
  bindCoplaActions(view);
  bindPieceDrag(view);
}

function moveDraftCopla(coplaUid, targetSectionId, beforeCoplaUid = null) {
  const draft = loadDraft();
  let moving = null;
  draft.sections.forEach(section => {
    const index = section.coplas.findIndex(item => String(item.uid || item.id) === String(coplaUid));
    if (index >= 0) [moving] = section.coplas.splice(index, 1);
  });
  if (!moving) return;
  const target = draft.sections.find(section => section.id === targetSectionId) || draft.sections[0];
  const beforeIndex = beforeCoplaUid ? target.coplas.findIndex(item => String(item.uid || item.id) === String(beforeCoplaUid)) : -1;
  if (beforeIndex >= 0) target.coplas.splice(beforeIndex, 0, moving);
  else target.coplas.push(moving);
  saveDraft(draft);
  renderPiecesView();
}

function bindPieceDrag(root) {
  all("[data-drag-copla]", root).forEach(card => {
    card.addEventListener("dragstart", event => {
      event.dataTransfer.setData("text/plain", card.dataset.dragCopla);
      event.dataTransfer.effectAllowed = "move";
      card.classList.add("dragging");
    });
    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      all(".drop-before, .drop-after", root).forEach(item => item.classList.remove("drop-before", "drop-after"));
    });
    card.addEventListener("dragover", event => {
      event.preventDefault();
      const box = card.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      card.classList.toggle("drop-before", !after);
      card.classList.toggle("drop-after", after);
    });
    card.addEventListener("dragleave", () => card.classList.remove("drop-before", "drop-after"));
    card.addEventListener("drop", event => {
      event.preventDefault();
      const coplaUid = event.dataTransfer.getData("text/plain");
      if (!coplaUid || String(coplaUid) === String(card.dataset.dragCopla)) return;
      const box = card.getBoundingClientRect();
      const after = event.clientY > box.top + box.height / 2;
      const nextCard = after ? card.nextElementSibling?.closest?.("[data-drag-copla]") : card;
      moveDraftCopla(coplaUid, card.dataset.section, nextCard?.dataset.dragCopla || null);
    });
  });
  all("[data-drop-section]", root).forEach(stack => {
    stack.addEventListener("dragover", event => {
      event.preventDefault();
      stack.classList.add("drop-target");
    });
    stack.addEventListener("dragleave", () => stack.classList.remove("drop-target"));
    stack.addEventListener("drop", event => {
      event.preventDefault();
      stack.classList.remove("drop-target");
      const coplaUid = event.dataTransfer.getData("text/plain");
      if (coplaUid) moveDraftCopla(coplaUid, stack.dataset.dropSection);
    });
  });
}

function buildPiecePayload() {
  const draft = loadDraft();
  let position = 0;
  return {
    title: draft.title || "Peza sen título",
    slug: slugify(draft.title || "peza"),
    author: draft.author || "Sen autoría",
    context_territory_id: draft.territoryId || state.selectedTerritory?.id || null,
    sections: draft.sections.map(section => ({
      label: section.label || "Parte",
      coplas: section.coplas.map(copla => {
        position += 1;
        const numericId = Number(copla.id);
        return {
          copla_id: Number.isInteger(numericId) && numericId > 0 ? numericId : null,
          text: copla.text || "",
          incipit: copla.incipit || firstLine(copla.text),
          territory: copla.territory || "",
          position,
          section_label: section.label || "Parte",
          role: copla.role || "copla",
        };
      }),
    })),
  };
}

function buildPieceDbPayload() {
  const draft = loadDraft();
  const coplas = [];
  let position = 0;
  let hasInlineCoplas = false;
  draft.sections.forEach(section => {
    section.coplas.forEach(copla => {
      position += 1;
      const numericId = Number(copla.id);
      if (!Number.isInteger(numericId) || numericId <= 0) {
        hasInlineCoplas = true;
        return;
      }
      coplas.push({
        copla_id: numericId,
        position,
        section_label: section.label || "Parte",
      });
    });
  });
  if (hasInlineCoplas) {
    throw new Error("Esta peza contén coplas importadas sen ID. Garda primeiro esas coplas no corpus ou importa a peza mediante JSON cando definamos ese formato.");
  }
  if (!coplas.length) {
    throw new Error("Engade polo menos unha copla á peza antes de gardala.");
  }
  const title = draft.title || territoryContextTitle(pieceTerritory()) || "Peza sen título";
  return {
    pieces: [{
      title,
      slug: slugify(`${title}-${Date.now()}`),
      author: draft.author || "Sen autoría",
      context_territory_id: draft.territoryId || state.selectedTerritory?.id || null,
      description: "",
      notes: "",
      status: "draft",
      coplas,
    }],
  };
}

async function savePieceDirect() {
  const feedback = $("#pieceExportStatus");
  try {
    const payload = buildPieceDbPayload();
    if (feedback) feedback.textContent = "Gardando peza na base local...";
    const response = await fetch("../api/pieces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Non se puido gardar a peza.");
    if (feedback) feedback.textContent = `Peza gardada. ID: ${result.ids.join(", ")}`;
    clearApiCache();
    state.pezas = await getPezas();
    state.pieceTab = "library";
    renderPiecesView();
  } catch (error) {
    if (feedback) {
      feedback.textContent = error.message;
      feedback.classList.add("is-error");
    }
  }
}

function filenameFromResponse(response, fallback) {
  const header = response.headers.get("Content-Disposition") || "";
  const match = header.match(/filename\*?=(?:UTF-8''|")?([^";]+)/i);
  if (match?.[1]) return decodeURIComponent(match[1].replace(/"/g, ""));
  return fallback;
}

function setExportStatus(message, isError = false) {
  const status = $("#pieceExportStatus");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-error", isError);
}

function closePdfViewer() {
  const viewer = $("#pdfViewer");
  if (state.pdfUrl) URL.revokeObjectURL(state.pdfUrl);
  state.pdfUrl = "";
  state.pdfFilename = "";
  if (viewer) {
    viewer.hidden = true;
    viewer.innerHTML = "";
  }
}

function openPdfViewer(blob, filename) {
  closePdfViewer();
  state.pdfUrl = URL.createObjectURL(blob);
  state.pdfFilename = filename;
  const viewer = $("#pdfViewer");
  if (!viewer) return;
  viewer.innerHTML = `
    <div class="pdf-backdrop" data-close-pdf></div>
    <section class="pdf-panel" role="dialog" aria-modal="true" aria-label="Previsualización PDF">
      <header class="pdf-head">
        <div>
          <div class="eyebrow">Previsualización</div>
          <h2>${escapeHtml(filename)}</h2>
        </div>
        <button class="drawer-close" type="button" data-close-pdf aria-label="Pechar">×</button>
      </header>
      <object class="pdf-frame" data="${state.pdfUrl}" type="application/pdf" aria-label="Previsualización PDF">
        <p>Non foi posíbel previsualizar o PDF neste navegador. Podes descargalo co botón inferior.</p>
      </object>
      <footer class="pdf-actions">
        <a class="btn primary" id="downloadGeneratedPdf" href="${state.pdfUrl}" download="${escapeHtml(filename)}">Descargar PDF</a>
        <button class="btn" type="button" data-close-pdf>Pechar</button>
      </footer>
    </section>
  `;
  viewer.hidden = false;
  all("[data-close-pdf]", viewer).forEach(button => button.addEventListener("click", closePdfViewer));
}

async function exportPiecePdf() {
  if (state.pdfBusy) return;
  const button = $("#openA4");
  state.pdfBusy = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Xerando PDF...";
  }
  setExportStatus("Xerando PDF...");
  try {
    const response = await fetch("../api/pdf/piece-draft", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPiecePayload()),
    });
    if (!response.ok) {
      let detail = "";
      try {
        detail = (await response.json()).error || "";
      } catch {
        detail = await response.text();
      }
      throw new Error(detail || `HTTP ${response.status}`);
    }
    const blob = await response.blob();
    if (blob.type && blob.type !== "application/pdf") {
      throw new Error(`Resposta inesperada: ${blob.type}`);
    }
    const filename = filenameFromResponse(response, `fol-e-ar-${slugify(loadDraft().title || "peza")}.pdf`);
    openPdfViewer(blob, filename);
    setExportStatus("");
  } catch (error) {
    console.error("Erro xerando PDF", error);
    const localHint = location.hostname.includes("localhost") || location.hostname === "127.0.0.1"
      ? "Non foi posíbel xerar o PDF."
      : "A exportación PDF require abrir Fol e Ar co servidor local.";
    setExportStatus(localHint, true);
  } finally {
    state.pdfBusy = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Exportar PDF";
    }
  }
}

function renderTerritorySearchResults(root = $("#view-territory")) {
  const results = $("#territorySearchResults", root);
  if (!results) return;
  const query = state.territoryQuery.trim();
  if (!query) {
    results.innerHTML = "";
    return;
  }
  const matches = searchTerritories(state.territorios, query).slice(0, 30);
  results.innerHTML = matches.map(item => `<button type="button" data-territory-id="${item.id}"><strong>${escapeHtml(item.nome)}</strong><span>${escapeHtml(territorySearchMeta(item))}</span></button>`).join("") || `<p class="muted">Sen resultados.</p>`;
  bindResultButtons(results);
}

function breadcrumbTrail(territory, ctx) {
  if (!territory) return "Galiza";
  return ctx.hierarchy.map(item => `
    <button type="button" data-territory-id="${item.id}">${escapeHtml(item.nome)}</button>
  `).join(`<span>/</span>`);
}

function updateTerritoryTabPanel(root = $("#view-territory")) {
  const panel = $("#territoryTabPanel", root);
  if (!panel) return;
  panel.innerHTML = renderTerritoryTab(state.selectedTerritory, placeContext(state.selectedTerritory));
  bindTerritoryTabs(root);
  bindResultButtons(panel);
  bindCoplaActions(panel);
  bindMediaCards(panel);
}

function bindTerritoryTabs(root = $("#view-territory")) {
  all("[data-territory-tab]", root).forEach(button => {
    button.classList.toggle("active", button.dataset.territoryTab === state.territoryTab);
    if (button.dataset.boundTerritoryTab) return;
    button.dataset.boundTerritoryTab = "true";
    button.addEventListener("click", () => {
      state.territoryTab = button.dataset.territoryTab;
      updateTerritoryTabPanel(root);
    });
  });
}

function renderTerritoryView() {
  const view = $("#view-territory");
  const territory = state.selectedTerritory;
  const query = state.territoryQuery;
  const ctx = placeContext(territory);
  const direct = territory ? ctx.coplas.filter(copla => (copla.territories || []).some(item => item.id === territory.id)).length : ctx.coplas.length;
  const tabs = [
    ["summary", "Resumo"],
    ["coplas", "Coplas"],
    ["pieces", "Pezas"],
    ["melodies", "Melodías"],
    ["media", "Media"],
    ...(territory?.tipo === "par" ? [] : [["children", "Subterritorios"]]),
  ];
  if (territory?.tipo === "par" && state.territoryTab === "children") state.territoryTab = "summary";
  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Territorios</div>
          <h1>${territory ? escapeHtml(territory.nome) : "Galiza"}</h1>
          <p>${territory ? "Xerarquía, coplas directas, material herdado, pezas e media." : "Visión xeral do arquivo. Para media, melodías e navegación fina escolle unha provincia, comarca, concello ou parroquia."}</p>
        </div>
        <button class="btn primary" type="button" data-view="map">Ver no mapa</button>
      </div>
      <div class="toolbar">
        <div class="searchbox"><span>⌕</span><input id="territorySearch" type="search" value="${escapeHtml(query)}" placeholder="Buscar parroquia, concello, comarca..."></div>
      </div>
      <div id="territorySearchResults" class="territory-results"></div>
      <div class="territory-hero">
        <section class="territory-card">
          <div class="breadcrumbs">${breadcrumbTrail(territory, ctx)}</div>
          <div class="eyebrow">${escapeHtml(territory ? territoryLabel(territory) : "País")}</div>
          <h1>${territory ? escapeHtml(territory.nome) : "Galiza"}</h1>
          <p>${territory ? `${direct} coplas directas e ${Math.max(ctx.coplas.length - direct, 0)} herdadas dos subterritorios.` : `${ctx.coplas.length} coplas no conxunto do arquivo. A vista xeral amosa unha mostra e deixa a exploración completa para territorios menores.`}</p>
          <div class="stats">
            <div class="stat"><b>${ctx.coplas.length}</b><span>coplas</span></div>
            <div class="stat"><b>${ctx.pezas.length}</b><span>pezas</span></div>
            <div class="stat"><b>${ctx.media.length}</b><span>media</span></div>
          </div>
        </section>
        <section class="territory-mini-map-wrap">
          <div id="territoryMiniMap" class="territory-mini-map"></div>
        </section>
      </div>
      <div class="territory-tabs">
        ${tabs.map(([key, label]) => `<button class="${state.territoryTab === key ? "active" : ""}" type="button" data-territory-tab="${key}">${label}</button>`).join("")}
      </div>
      <div id="territoryTabPanel">${renderTerritoryTab(territory, ctx)}</div>
    </div>
  `;
  $("#territorySearch")?.addEventListener("input", event => {
    state.territoryQuery = event.target.value;
    renderTerritorySearchResults(view);
  });
  bindTerritoryTabs(view);
  bindResultButtons(view);
  bindCoplaActions(view);
  renderTerritorySearchResults(view);
  renderTerritoryMiniMap(territory);
}

function renderTerritoryTab(territory, ctx) {
  if (!territory) {
    if (state.territoryTab === "coplas") {
      const sample = ctx.coplas.slice(0, 24);
      return `
        <div class="section-title"><h2>Coplas de Galiza</h2><span class="muted">${ctx.coplas.length} no arquivo</span></div>
        <div class="territory-limit">Mostrando unha mostra inicial. Para traballar con todas as coplas dun ámbito concreto, escolle unha provincia, comarca, concello ou parroquia.</div>
        <div class="copla-gallery territory-copla-grid">${sample.map(copla => coplaCard(copla)).join("") || `<p class="muted">Aínda non hai coplas no arquivo.</p>`}</div>
      `;
    }
    if (["pieces", "melodies", "media"].includes(state.territoryTab)) {
      return `
        <section class="panel territory-limit-panel">
          <h2>Escolle un territorio menor</h2>
          <p class="muted">Para evitar unha pantalla inmanexable, as pezas, melodías e recursos multimedia explóranse desde provincia, comarca, concello ou parroquia.</p>
        </section>
      `;
    }
    return `
      <div class="section-title"><h2>Resumo textual</h2><button class="btn" type="button" data-territory-tab="coplas">Ver mostra de coplas</button></div>
      <div class="territory-limit">Galiza funciona aquí como vista xeral. Baixa a unha entidade territorial para consultar media, melodías e pezas con precisión.</div>
      <div class="copla-list">${ctx.coplas.slice(0, 6).map(copla => coplaCard(copla, { list: true })).join("") || `<p class="muted">Aínda non hai coplas no arquivo.</p>`}</div>
      <div class="section-title"><h2>Provincias</h2></div>
      <div class="territory-results">${ctx.children.map(item => `<button type="button" data-territory-id="${item.id}"><strong>${escapeHtml(item.nome)}</strong><span>${escapeHtml(territorySearchMeta(item))}</span></button>`).join("")}</div>
    `;
  }
  if (state.territoryTab === "coplas") {
    return `
      <div class="section-title"><h2>Coplas de ${escapeHtml(territory.nome)}</h2><span class="muted">${ctx.coplas.length} resultados</span></div>
      <div class="copla-gallery territory-copla-grid">${ctx.coplas.map(copla => coplaCard(copla)).join("") || `<p class="muted">Aínda non hai coplas neste territorio.</p>`}</div>
    `;
  }
  if (state.territoryTab === "pieces") {
    return `
      <div class="section-title"><h2>Pezas relacionadas</h2><span class="muted">${ctx.pezas.length} resultados</span></div>
      <div class="copla-gallery">${ctx.pezas.map(piece => `
        <article class="gallery-card">
          <div><div class="eyebrow">Peza</div><h2>${escapeHtml(piece.title || piece.titulo || "Peza sen título")}</h2><p>${escapeHtml(piece.description || piece.notes || "Sen descrición.")}</p></div>
          <div class="meta"><span class="tag place">${escapeHtml(territory.nome)}</span></div>
        </article>
      `).join("") || `<p class="muted">Aínda non hai pezas neste territorio.</p>`}</div>
    `;
  }
  if (state.territoryTab === "media") {
    const media = ctx.media.filter(item => ["documental", "mixed"].includes(mediaRole(item)));
    return `
      <div class="section-title"><h2>Media relacionada</h2><button class="btn" type="button" data-view="media" data-media-role="documental">+ Novo recurso</button><span class="muted">${media.length} recursos</span></div>
      <div class="media-grid">${media.map(mediaCard).join("") || `<article class="panel"><p class="muted">Aínda non hai media documental neste territorio.</p></article>`}</div>
    `;
  }
  if (state.territoryTab === "melodies") {
    const melodies = ctx.media.filter(item => ["melody", "mixed"].includes(mediaRole(item)));
    return `
      <div class="section-title"><h2>Melodías</h2><button class="btn" type="button" data-view="media" data-media-role="melody">+ Novo recurso</button><span class="muted">${melodies.length} recursos sonoros</span></div>
      <div class="media-grid">${melodies.map(mediaCard).join("") || `<article class="panel"><p class="muted">Aínda non hai melodías rexistradas neste territorio. A pantalla xa admite audio local, vídeo, YouTube e Spotify cando se dean de alta.</p></article>`}</div>
    `;
  }
  if (state.territoryTab === "children") {
    return `
      <div class="section-title"><h2>Subterritorios</h2><span class="muted">${ctx.children.length} elementos</span></div>
      <div class="territory-results">${ctx.children.map(item => `<button type="button" data-territory-id="${item.id}"><strong>${escapeHtml(item.nome)}</strong><span>${escapeHtml(territorySearchMeta(item))}</span></button>`).join("") || `<p class="muted">Sen subterritorios neste nivel.</p>`}</div>
    `;
  }
  return `
    <div class="section-title"><h2>Resumo textual</h2><button class="btn" type="button" data-territory-tab="coplas">Ver coplas aquí</button></div>
    <div class="copla-list">${ctx.coplas.slice(0, 6).map(copla => coplaCard(copla, { list: true })).join("") || `<p class="muted">Aínda non hai coplas neste territorio.</p>`}</div>
    <div class="section-title"><h2>Subterritorios</h2></div>
    <div class="territory-results">${ctx.children.slice(0, 18).map(item => `<button type="button" data-territory-id="${item.id}"><strong>${escapeHtml(item.nome)}</strong><span>${escapeHtml(territorySearchMeta(item))}</span></button>`).join("") || `<p class="muted">Sen subterritorios neste nivel.</p>`}</div>
  `;
}

async function renderTerritoryMiniMap(territory) {
  const el = $("#territoryMiniMap");
  if (!el) return;
  if (!window.L) {
    el.innerHTML = `<div class="map-fallback"><p>Mini-mapa non dispoñible.</p></div>`;
    return;
  }
  if (state.miniMap) {
    state.miniMap.remove();
    state.miniMap = null;
    state.miniLayer = null;
  }
  state.miniMap = L.map(el, {
    attributionControl: false,
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView([42.8, -8.2], 8);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18 }).addTo(state.miniMap);
  if (!territory) {
    try {
      let data = await geoLayerForMap("prov");
      state.miniLayer = L.geoJSON(data, {
        style: { weight: 1.4, color: "#315f4b", fillColor: "#8ca99b", fillOpacity: 0.26 },
      }).addTo(state.miniMap);
      window.setTimeout(() => {
        state.miniMap.invalidateSize();
        try {
          state.miniMap.fitBounds(state.miniLayer.getBounds(), { padding: [18, 18] });
        } catch {}
      }, 80);
    } catch {
      window.setTimeout(() => state.miniMap.invalidateSize(), 80);
    }
    return;
  }
  try {
    let data = await geoLayerForMap(territory.tipo);
    const activeBounds = [];
    state.miniLayer = L.geoJSON(data, {
      style: feature => {
        const item = findTerritoryByFeature(feature, territory.tipo, state.territorios);
        const active = item?.id === territory.id;
        return {
          weight: active ? 2.4 : 0.8,
          color: active ? "#1f5a42" : "#7d887f",
          fillColor: active ? "#6f9f86" : "#f8faf6",
          fillOpacity: active ? 0.48 : 0.12,
          dashArray: feature?.properties?.part ? "3 3" : null,
        };
      },
      onEachFeature: (feature, layer) => {
        const item = findTerritoryByFeature(feature, territory.tipo, state.territorios);
        if (item?.id === territory.id) activeBounds.push(layer.getBounds());
        if (!item) return;
        const council = parentCouncil(item);
        layer.bindTooltip(`${item.nome}${item.tipo === "par" && council?.nome ? ` · ${council.nome}` : ""}`, { sticky: true });
        layer.on("click", async () => {
          await selectTerritory(item);
          renderTerritoryView();
        });
        layer.on("mouseover", () => layer.setStyle({ fillOpacity: item.id === territory.id ? 0.56 : 0.28, weight: item.id === territory.id ? 2.4 : 1.4 }));
        layer.on("mouseout", () => state.miniLayer?.resetStyle(layer));
      },
    }).addTo(state.miniMap);
    window.setTimeout(() => {
      state.miniMap.invalidateSize();
      try {
        const bounds = activeBounds[0] || state.miniLayer.getBounds();
        state.miniMap.fitBounds(bounds, { padding: [50, 50], maxZoom: territory.tipo === "par" ? 13 : 10 });
      } catch {}
    }, 80);
  } catch {
    el.innerHTML = `<span>Non se puido cargar a xeometría.</span>`;
  }
}

function renderSubmitView() {
  const view = $("#view-submit");
  const batch = loadBatch();
  if (!state.submitTerritoryIds.length && state.submitTerritoryId) state.submitTerritoryIds = [state.submitTerritoryId];
  if (!state.submitTerritoryIds.length && state.selectedTerritory) state.submitTerritoryIds = [state.selectedTerritory.id];
  const selectedTerritories = state.submitTerritoryIds.map(id => state.territorios.find(item => item.id === id)).filter(Boolean);
  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Alta</div>
          <h1>Novas entradas</h1>
          <p>Formulario local para introducir corpus e recursos sen escribir JSON cando o servidor está activo.</p>
        </div>
      </div>
      <div class="layout-two">
        <section class="panel">
          <div class="section-title"><h2>Copla</h2></div>
          <div class="formgrid">
            <div class="field full"><label>Texto principal</label><textarea id="newText" rows="7" placeholder="Escribe a copla..."></textarea></div>
            <div class="field"><label>Estado territorial</label><select id="newState"><option value="assigned">Asignada a lugar</option><option value="unassigned">Lugar descoñecido</option><option value="general">Galiza xeral</option></select></div>
            <div class="field"><label>Territorios</label><input id="territoryQuery" type="search" placeholder="Buscar e engadir varios territorios..."></div>
            <div class="field full"><div id="territoryPickerResults" class="territory-results compact"></div></div>
            <div class="field full"><div id="selectedTerritoryChips" class="selected-chips">${selectedTerritories.map(item => selectedTerritoryChip(item, "copla")).join("") || `<p class="muted">Sen territorio seleccionado.</p>`}</div></div>
            <div class="field"><label>Perfil lingüístico</label><select id="newLanguage"><option value="">Sen marcar</option><option value="lingua-galego">Galego</option><option value="lingua-castelan">Castelán</option><option value="lingua-castrapo">Castrapo / mestura</option></select></div>
            <div class="field"><label>Etiquetas</label><input id="newTags" type="text" placeholder="amor, romaría, traballo..."></div>
            <div class="field full"><label>Notas</label><textarea id="newNotes" rows="3" placeholder="Fonte, contexto, dúbidas editoriais..."></textarea></div>
          </div>
        </section>
        <aside class="panel sticky">
          <div class="section-title"><h2>Variantes</h2><button class="btn" type="button" id="addVersion">Engadir</button></div>
          <div id="versionRows" class="version-rows"></div>
          <div class="section-title"><h2>Gardar</h2></div>
          <div class="gallery-actions vertical">
            <button class="btn primary" type="button" id="saveDirect">Gardar na base local</button>
            <button class="btn" type="button" id="addToBatch">Engadir ao lote</button>
            <button class="btn" type="button" id="downloadBatch">Descargar lote</button>
          </div>
          <p id="submitFeedback" class="muted">${batch.length} entradas no lote.</p>
        </aside>
      </div>
      <section class="panel batch-import-panel">
        <div class="section-title"><h2>Importar JSON</h2><span class="muted">Coplas en lote</span></div>
        <div class="formgrid">
          <div class="field full"><label>Ficheiro JSON</label><input id="coplaJsonFile" type="file" accept="application/json,.json"></div>
          <div class="field full"><label>Ou pega JSON</label><textarea id="coplaJsonText" rows="7" placeholder='{\"coplas\":[...]}'></textarea></div>
        </div>
        <div class="gallery-actions">
          <button class="btn primary" type="button" id="importCoplaJson">Importar coplas JSON</button>
          <p id="jsonImportFeedback" class="muted">Deixo preparada a entrada; cando definas o formato pechámola fino.</p>
        </div>
      </section>
    </div>
  `;
  bindTerritoryPicker();
  bindSelectedTerritoryChips(view);
  $("#addVersion")?.addEventListener("click", addVersionRow);
  $("#addToBatch")?.addEventListener("click", () => {
    const payload = buildCoplaPayloadFromForm();
    if (!payload) return;
    const next = loadBatch();
    next.unshift(payload);
    saveBatch(next);
    renderSubmitView();
  });
  $("#downloadBatch")?.addEventListener("click", () => downloadText("coplas-lote.json", JSON.stringify({ coplas: loadBatch() }, null, 2), "application/json"));
  $("#saveDirect")?.addEventListener("click", saveCoplaDirect);
  $("#importCoplaJson")?.addEventListener("click", importCoplaJson);
}

function addVersionRow() {
  const row = document.createElement("div");
  row.className = "version-row";
  row.innerHTML = `<input type="text" placeholder="Etiqueta da variante"><textarea rows="3" placeholder="Texto da variante"></textarea><input type="text" placeholder="Notas">`;
  $("#versionRows").appendChild(row);
}

function selectedTerritoryChip(territory, kind) {
  return `
    <span class="selected-chip">
      ${escapeHtml(territory.nome)} <small>${escapeHtml(territoryLabel(territory))}</small>
      <button type="button" data-remove-${kind}-territory="${territory.id}" aria-label="Retirar ${escapeHtml(territory.nome)}">×</button>
    </span>
  `;
}

function mediaFormMarkup(selectedMediaTerritories) {
  const defaultRole = state.mediaDefaultRole || (state.territoryTab === "melodies" ? "melody" : "documental");
  return `
    <section class="panel submit-media-panel">
      <div class="section-title"><h2>Novo recurso</h2><span class="muted">Documental, melodía ou ambos</span></div>
      <div class="formgrid">
        <div class="field"><label>Título</label><input id="mediaTitle" type="text" placeholder="Xota 1, Muiñeira de Sequeiros..."></div>
        <div class="field"><label>Tipo</label><select id="mediaKind"><option value="youtube">YouTube</option><option value="spotify">Spotify</option><option value="soundcloud">SoundCloud</option><option value="audio">Audio</option><option value="video">Vídeo</option><option value="image">Imaxe</option><option value="web">Web</option></select></div>
        <div class="field"><label>Uso no arquivo</label><select id="mediaRole"><option value="documental" ${defaultRole === "documental" ? "selected" : ""}>Media documental</option><option value="melody" ${defaultRole === "melody" ? "selected" : ""}>Melodía / recurso musical</option><option value="mixed">Ambas cousas</option></select></div>
        <div class="field full"><label>URL</label><div class="input-action"><input id="mediaUrl" type="url" placeholder="https://..."><button class="btn" type="button" id="fetchMediaMeta">Obter datos</button></div></div>
        <div class="field"><label>Fonte ou autoría</label><input id="mediaSource" type="text" placeholder="Canle, intérprete, arquivo..."></div>
        <div class="field"><label>Miniatura opcional</label><input id="mediaThumb" type="url" placeholder="https://..."></div>
        <div class="field full"><label>Descrición</label><textarea id="mediaDescription" rows="3" placeholder="Contexto, relación coa melodía, observacións..."></textarea></div>
        <div class="field"><label>Territorios vinculados</label><input id="mediaTerritoryQuery" type="search" placeholder="Buscar e engadir territorios..."></div>
        <div class="field full"><div id="mediaTerritoryResults" class="territory-results compact"></div></div>
        <div class="field full"><div id="selectedMediaTerritoryChips" class="selected-chips">${selectedMediaTerritories.map(item => selectedTerritoryChip(item, "media")).join("") || `<p class="muted">Sen territorio seleccionado.</p>`}</div></div>
      </div>
      <div class="gallery-actions">
        <button class="btn primary" type="button" id="saveMediaDirect">Gardar media na base local</button>
        <p id="mediaFeedback" class="muted"></p>
      </div>
    </section>
  `;
}

function mediaModalMarkup(selectedMediaTerritories) {
  if (!state.mediaModalOpen) return "";
  return `
    <div class="media-modal" id="mediaModal" role="dialog" aria-modal="true" aria-label="Novo recurso">
      <div class="media-modal-backdrop" data-close-media-modal></div>
      <div class="media-modal-panel">
        <div class="media-modal-head">
          <div>
            <div class="eyebrow">Alta de media</div>
            <h2>Novo recurso</h2>
          </div>
          <button class="card-close" type="button" data-close-media-modal aria-label="Pechar">×</button>
        </div>
        ${mediaFormMarkup(selectedMediaTerritories)}
      </div>
    </div>
  `;
}

function openMediaModal(role = "") {
  state.mediaDefaultRole = role || "";
  state.mediaModalOpen = true;
  renderMediaView();
}

function closeMediaModal() {
  state.mediaModalOpen = false;
  state.mediaDefaultRole = "";
  renderMediaView();
}

function refreshSelectedTerritoryChips() {
  const coplaChips = $("#selectedTerritoryChips");
  if (coplaChips) {
    const selected = state.submitTerritoryIds.map(id => state.territorios.find(item => item.id === id)).filter(Boolean);
    coplaChips.innerHTML = selected.map(item => selectedTerritoryChip(item, "copla")).join("") || `<p class="muted">Sen territorio seleccionado.</p>`;
  }
  const mediaChips = $("#selectedMediaTerritoryChips");
  if (mediaChips) {
    const selected = state.mediaTerritoryIds.map(id => state.territorios.find(item => item.id === id)).filter(Boolean);
    mediaChips.innerHTML = selected.map(item => selectedTerritoryChip(item, "media")).join("") || `<p class="muted">Sen territorio seleccionado.</p>`;
  }
  bindSelectedTerritoryChips();
}

function bindSelectedTerritoryChips(root = document) {
  all("[data-remove-copla-territory]", root).forEach(button => button.addEventListener("click", () => {
    state.submitTerritoryIds = state.submitTerritoryIds.filter(id => id !== button.dataset.removeCoplaTerritory);
    state.submitTerritoryId = state.submitTerritoryIds[0] || "";
    refreshSelectedTerritoryChips();
  }));
  all("[data-remove-media-territory]", root).forEach(button => button.addEventListener("click", () => {
    state.mediaTerritoryIds = state.mediaTerritoryIds.filter(id => id !== button.dataset.removeMediaTerritory);
    refreshSelectedTerritoryChips();
  }));
}

function bindTerritoryPicker() {
  const input = $("#territoryQuery");
  const results = $("#territoryPickerResults");
  if (!input || !results) return;
  input.addEventListener("input", () => {
    const query = input.value.trim();
    if (!query) {
      results.innerHTML = "";
      return;
    }
    const matches = searchTerritories(state.territorios, query).slice(0, 12);
    results.innerHTML = matches.map(item => `
      <button type="button" data-pick-territory="${item.id}">
        <strong>${escapeHtml(item.nome)}</strong>
        <span>${escapeHtml(territorySearchMeta(item))}</span>
      </button>
    `).join("") || `<p class="muted">Sen resultados.</p>`;
    all("[data-pick-territory]", results).forEach(button => button.addEventListener("click", () => {
      const territory = state.territorios.find(item => item.id === button.dataset.pickTerritory);
      if (!territory) return;
      if (!state.submitTerritoryIds.includes(territory.id)) state.submitTerritoryIds.push(territory.id);
      state.submitTerritoryId = state.submitTerritoryIds[0] || "";
      input.value = "";
      results.innerHTML = "";
      refreshSelectedTerritoryChips();
    }));
  });
}

function bindMediaTerritoryPicker() {
  const input = $("#mediaTerritoryQuery");
  const results = $("#mediaTerritoryResults");
  if (!input || !results) return;
  input.addEventListener("input", () => {
    const query = input.value.trim();
    if (!query) {
      results.innerHTML = "";
      return;
    }
    const matches = searchTerritories(state.territorios, query).slice(0, 12);
    results.innerHTML = matches.map(item => `
      <button type="button" data-pick-media-territory="${item.id}">
        <strong>${escapeHtml(item.nome)}</strong>
        <span>${escapeHtml(territorySearchMeta(item))}</span>
      </button>
    `).join("") || `<p class="muted">Sen resultados.</p>`;
    all("[data-pick-media-territory]", results).forEach(button => button.addEventListener("click", () => {
      const territory = state.territorios.find(item => item.id === button.dataset.pickMediaTerritory);
      if (!territory) return;
      if (!state.mediaTerritoryIds.includes(territory.id)) state.mediaTerritoryIds.push(territory.id);
      input.value = "";
      results.innerHTML = "";
      refreshSelectedTerritoryChips();
    }));
  });
}

function buildCoplaPayloadFromForm() {
  const text = $("#newText").value.trim();
  const feedback = $("#submitFeedback");
  if (!text) {
    feedback.textContent = "Escribe o texto da copla antes de gardar.";
    return null;
  }
  const territoryState = $("#newState").value;
  const territoryIds = Array.from(new Set(state.submitTerritoryIds));
  if (territoryState === "assigned" && !territoryIds.length) {
    feedback.textContent = "Busca e selecciona polo menos un territorio, ou cambia o estado territorial.";
    return null;
  }
  const versions = all(".version-row").map(row => ({
    label: $("input", row).value,
    text: $("textarea", row).value,
    notes: all("input", row)[1].value,
  })).filter(item => item.text.trim());
  const languageTag = $("#newLanguage")?.value || "";
  const tags = $("#newTags").value.split(",").map(item => normalizeText(item)).filter(Boolean);
  if (languageTag) tags.push(languageTag);
  return {
    text,
    notes: $("#newNotes").value,
    status: "published",
    territory_state: territoryState,
    territories: territoryState === "assigned" ? territoryIds.map(id => ({ id })) : [],
    tags: Array.from(new Set(tags)),
    versions,
  };
}

async function importCoplaJson() {
  const feedback = $("#jsonImportFeedback");
  const file = $("#coplaJsonFile")?.files?.[0];
  let text = $("#coplaJsonText")?.value.trim() || "";
  try {
    if (file) text = await file.text();
    if (!text) throw new Error("Escolle un ficheiro ou pega un JSON.");
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.coplas)) throw new Error("O JSON debe ter a forma { \"coplas\": [...] }.");
    if (feedback) feedback.textContent = "Importando coplas...";
    const response = await fetch("../api/coplas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Non se puido importar o JSON.");
    if (feedback) feedback.textContent = `Importación completada. IDs afectados: ${result.ids.join(", ")}`;
    clearApiCache();
    state.coplas = await getCoplas();
  } catch (error) {
    if (feedback) {
      feedback.textContent = error.message;
      feedback.classList.add("is-error");
    }
  }
}

function buildMediaPayloadFromForm() {
  const feedback = $("#mediaFeedback");
  const title = $("#mediaTitle").value.trim();
  const url = $("#mediaUrl").value.trim();
  const kind = $("#mediaKind").value;
  const role = $("#mediaRole")?.value || "documental";
  const territoryIds = Array.from(new Set(state.mediaTerritoryIds));
  if (!title || !url) {
    feedback.textContent = "Indica título e URL.";
    return null;
  }
  if (!territoryIds.length) {
    feedback.textContent = "Selecciona polo menos un territorio para vincular este recurso.";
    return null;
  }
  return {
    media: [{
      provider: kind,
      media_kind: kind,
      title,
      url,
      description: $("#mediaDescription").value.trim() || null,
      author_or_source: $("#mediaSource").value.trim() || null,
      thumbnail_url: $("#mediaThumb").value.trim() || null,
      status: "published",
      links: territoryIds.map(id => ({ entity_type: "territory", entity_id: id, relation_type: role })),
    }],
  };
}

async function saveCoplaDirect() {
  const payload = buildCoplaPayloadFromForm();
  if (!payload) return;
  const feedback = $("#submitFeedback");
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
    const firstTerritoryId = payload.territories[0]?.id;
    state.selectedTerritory = firstTerritoryId ? state.territorios.find(item => item.id === firstTerritoryId) || state.selectedTerritory : state.selectedTerritory;
    state.coplaQuery = firstLine(payload.text);
    state.coplaStateFilter = "all";
    setView("coplas");
  } catch (error) {
    feedback.textContent = `${error.message} Podes engadir ao lote e descargalo como alternativa.`;
  }
}

async function fetchMediaMetadata(options = {}) {
  const feedback = $("#mediaFeedback");
  const url = $("#mediaUrl")?.value.trim();
  if (!url) {
    if (!options.silent && feedback) feedback.textContent = "Pega primeiro unha URL.";
    return;
  }
  if (feedback && !options.silent) feedback.textContent = "Lendo metadatos da ligazón...";
  try {
    const kind = mediaKind({ url });
    if ($("#mediaKind") && kind !== "web" && kind !== "media") $("#mediaKind").value = kind;
    const response = await fetch(`../api/link-preview?url=${encodeURIComponent(url)}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Non se puideron ler metadatos.");
    if (result.title && !$("#mediaTitle").value.trim()) $("#mediaTitle").value = result.title;
    if (result.description && !$("#mediaDescription").value.trim()) $("#mediaDescription").value = result.description;
    if (result.thumbnail_url && !$("#mediaThumb").value.trim()) $("#mediaThumb").value = result.thumbnail_url;
    if (result.provider && !$("#mediaSource").value.trim()) $("#mediaSource").value = result.provider;
    if (feedback) feedback.textContent = "Metadatos incorporados.";
  } catch (error) {
    if (feedback && !options.silent) feedback.textContent = `${error.message} Podes completar os campos manualmente.`;
  }
}

async function saveMediaDirect() {
  const payload = buildMediaPayloadFromForm();
  if (!payload) return;
  const feedback = $("#mediaFeedback");
  feedback.textContent = "Gardando media na base local...";
  try {
    const response = await fetch("../api/media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Non se puido gardar a media.");
    feedback.textContent = `Media gardada. IDs afectados: ${result.ids.join(", ")}`;
    clearApiCache();
    state.media = await getMedia();
    const firstTerritoryId = payload.media[0].links[0]?.entity_id;
    if (firstTerritoryId) state.selectedTerritory = state.territorios.find(item => item.id === firstTerritoryId) || state.selectedTerritory;
    state.mediaModalOpen = false;
    state.mediaDefaultRole = "";
    state.mediaQuery = "";
    state.mediaKindFilter = "";
    state.mediaRoleFilter = "";
    renderMediaView();
  } catch (error) {
    feedback.textContent = `${error.message} Comproba que estás usando ./serve.sh 8765.`;
  }
}

function renderMediaView() {
  const view = $("#view-media");
  if (!state.mediaTerritoryIds.length && state.selectedTerritory) state.mediaTerritoryIds = [state.selectedTerritory.id];
  const selectedMediaTerritories = state.mediaTerritoryIds.map(id => state.territorios.find(item => item.id === id)).filter(Boolean);
  const items = filteredMediaItems();
  view.innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Media</div>
          <h1>Media</h1>
          <p>Biblioteca global de audio, vídeo, documentos e ligazóns. O formulario lembra o territorio activo para axilizar a alta.</p>
        </div>
        <button class="btn primary" type="button" id="openMediaModal">+ Novo recurso</button>
      </div>
      <div class="toolbar media-toolbar">
        <div class="searchbox"><span>⌕</span><input id="mediaSearch" type="search" value="${escapeHtml(state.mediaQuery)}" placeholder="Buscar por título, fonte, territorio..."></div>
        <select id="mediaKindFilter" aria-label="Filtrar tipo de media">
          <option value="">Todos os tipos</option>
          ${["youtube", "spotify", "soundcloud", "audio", "video", "image", "web"].map(kind => `<option value="${kind}" ${state.mediaKindFilter === kind ? "selected" : ""}>${mediaLabel(kind)}</option>`).join("")}
        </select>
        <select id="mediaRoleFilter" aria-label="Filtrar uso">
          <option value="">Todos os usos</option>
          ${["documental", "melody", "mixed"].map(role => `<option value="${role}" ${state.mediaRoleFilter === role ? "selected" : ""}>${mediaRoleLabel(role)}</option>`).join("")}
        </select>
      </div>
      <div id="mediaList" class="media-grid">
        ${items.map(mediaCard).join("") || `<article class="panel"><p class="muted">Aínda non hai recursos multimedia para mostrar.</p></article>`}
      </div>
      ${mediaModalMarkup(selectedMediaTerritories)}
    </div>
  `;
  $("#openMediaModal")?.addEventListener("click", () => openMediaModal());
  $("#mediaSearch")?.addEventListener("input", event => {
    state.mediaQuery = event.target.value;
    updateMediaResults(view);
  });
  $("#mediaKindFilter")?.addEventListener("change", event => {
    state.mediaKindFilter = event.target.value;
    updateMediaResults(view);
  });
  $("#mediaRoleFilter")?.addEventListener("change", event => {
    state.mediaRoleFilter = event.target.value;
    updateMediaResults(view);
  });
  all("[data-close-media-modal]", view).forEach(item => item.addEventListener("click", closeMediaModal));
  bindMediaTerritoryPicker();
  bindSelectedTerritoryChips(view);
  bindMediaCards(view);
  $("#saveMediaDirect")?.addEventListener("click", saveMediaDirect);
  $("#fetchMediaMeta")?.addEventListener("click", fetchMediaMetadata);
  $("#mediaUrl")?.addEventListener("blur", () => {
    if (!$("#mediaTitle")?.value.trim()) fetchMediaMetadata({ silent: true });
  });
}

function filteredMediaItems() {
  const baseItems = state.media;
  const query = normalizeText(state.mediaQuery);
  return baseItems.filter(item => {
    const matchesKind = !state.mediaKindFilter || mediaKind(item) === state.mediaKindFilter;
    const role = mediaRole(item);
    const matchesRole = !state.mediaRoleFilter || role === state.mediaRoleFilter || (state.mediaRoleFilter !== "mixed" && role === "mixed");
    const territories = mediaTerritories(item);
    const matchesText = !query || normalizeText([
      item.title,
      item.description,
      item.author_or_source,
      item.provider,
      item.url,
      mediaRoleLabel(role),
      mediaLabel(mediaKind(item)),
      territories.map(territory => `${territory.nome} ${territorySearchMeta(territory)}`).join(" "),
      (item.links || []).map(link => `${link.entity_type} ${link.entity_id} ${link.relation_type}`).join(" "),
    ].join(" ")).includes(query);
    return matchesKind && matchesRole && matchesText;
  });
}

function updateMediaResults(root = $("#view-media")) {
  const list = $("#mediaList", root);
  if (!list) return;
  const items = filteredMediaItems();
  list.innerHTML = items.map(mediaCard).join("") || `<article class="panel"><p class="muted">Aínda non hai recursos multimedia para mostrar.</p></article>`;
  bindMediaCards(root);
}

function renderAboutTerritoryResults(root = $("#view-about")) {
  const results = $("#aboutTerritoryResults", root);
  if (!results) return;
  const query = state.aboutTerritoryQuery.trim();
  if (!query) {
    results.innerHTML = "";
    return;
  }
  const matches = searchTerritories(state.territorios, query).slice(0, 12);
  results.innerHTML = matches.map(item => `
    <button type="button" data-about-territory="${item.id}">
      <strong>${escapeHtml(item.nome)}</strong>
      <span>${escapeHtml(territorySearchMeta(item))}</span>
    </button>
  `).join("") || `<p class="muted">Sen resultados.</p>`;
  all("[data-about-territory]", results).forEach(button => button.addEventListener("click", () => {
    const territory = state.territorios.find(item => item.id === button.dataset.aboutTerritory);
    if (!territory) return;
    state.aboutTerritoryId = territory.id;
    state.aboutTerritoryQuery = territory.nome;
    const input = $("#aboutTerritorySearch", root);
    const label = $("#aboutTerritorySelected", root);
    if (input) input.value = territory.nome;
    if (label) label.textContent = `${territory.nome} · ${territorySearchMeta(territory)}`;
    results.innerHTML = "";
  }));
}

function submitAboutCopla(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const territory = state.territorios.find(item => item.id === state.aboutTerritoryId);
  const mediaFile = data.get("media_file");
  const payload = {
    text: String(data.get("text") || "").trim(),
    territory_id: territory?.id || "",
    territory_name: territory?.nome || String(data.get("territory_query") || "").trim(),
    source: String(data.get("source") || "").trim(),
    media_url: String(data.get("media_url") || "").trim(),
    media_file_name: mediaFile && typeof mediaFile === "object" ? mediaFile.name : "",
    notes: String(data.get("notes") || "").trim(),
  };
  const body = [
    "Nova copla enviada desde Fol e Ar",
    "",
    "Texto:",
    payload.text,
    "",
    `Territorio: ${payload.territory_name || "sen indicar"}`,
    `ID territorio: ${payload.territory_id || "sen confirmar"}`,
    `Fonte: ${payload.source || "sen indicar"}`,
    `Media/link: ${payload.media_url || "sen indicar"}`,
    payload.media_file_name ? `Arquivo mencionado: ${payload.media_file_name}` : "",
    "",
    "Notas:",
    payload.notes || "sen notas",
    "",
    "Payload para revisión:",
    JSON.stringify(payload, null, 2),
  ].filter(line => line !== "").join("\n");
  const subject = `Nova copla para Fol e Ar${payload.territory_name ? ` · ${payload.territory_name}` : ""}`;
  window.location.href = `mailto:folear3@gmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function renderAboutView() {
  $("#view-about").innerHTML = `
    <div class="page">
      <div class="page-head">
        <div>
          <div class="eyebrow">Proxecto</div>
          <h1>Sobre Fol e ar</h1>
          <p>Arquivo dixital para conservar, consultar e montar repertorio tradicional galego desde o territorio e desde o texto.</p>
        </div>
      </div>
      <div class="about-grid">
        <article class="panel"><h2>Explorar</h2><p>Mapa e territorios para descubrir repertorio sen coñecer previamente o corpus.</p></article>
        <article class="panel"><h2>Consultar</h2><p>Coplas en grade, lista ou galería, con procura textual e lectura de variantes.</p></article>
        <article class="panel"><h2>Construír</h2><p>Pezas como carriño editorial: escoller, ordenar, separar por ritmos e exportar para cantar.</p></article>
      </div>
      <section class="panel public-submit">
        <div class="section-title"><h2>Enviar unha copla</h2><span class="muted">Achega para revisión editorial</span></div>
        <form id="publicCoplaForm" class="formgrid">
          <div class="field full">
            <label>Texto da copla</label>
            <textarea name="text" rows="6" required placeholder="Escribe a copla conservando os saltos de verso..."></textarea>
          </div>
          <div class="field">
            <label>Territorio</label>
            <input id="aboutTerritorySearch" name="territory_query" type="search" value="${escapeHtml(state.aboutTerritoryQuery)}" placeholder="Buscar parroquia, concello...">
            <small id="aboutTerritorySelected">${state.aboutTerritoryId ? escapeHtml(state.territorios.find(item => item.id === state.aboutTerritoryId)?.nome || "") : "Podes deixalo sen confirmar se non o sabes."}</small>
            <div id="aboutTerritoryResults" class="territory-results compact"></div>
          </div>
          <div class="field">
            <label>Fonte</label>
            <input name="source" type="text" placeholder="Persoa, libro, recollida, memoria familiar...">
          </div>
          <div class="field">
            <label>Media ou ligazón</label>
            <input name="media_url" type="url" placeholder="YouTube, Spotify, web, arquivo publicado...">
          </div>
          <div class="field">
            <label>Arquivo local</label>
            <input name="media_file" type="file" accept="audio/*,video/*,image/*">
            <small>O navegador non pode anexalo automaticamente; o correo lembrará o nome do ficheiro.</small>
          </div>
          <div class="field full">
            <label>Notas</label>
            <textarea name="notes" rows="3" placeholder="Contexto, dúbidas, variante, quen a cantaba..."></textarea>
          </div>
          <div class="form-actions full">
            <button class="btn primary" type="submit">Enviar</button>
          </div>
        </form>
      </section>
    </div>
  `;
  $("#aboutTerritorySearch")?.addEventListener("input", event => {
    state.aboutTerritoryQuery = event.target.value;
    state.aboutTerritoryId = "";
    renderAboutTerritoryResults();
  });
  $("#publicCoplaForm")?.addEventListener("submit", submitAboutCopla);
  renderAboutTerritoryResults();
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([`${text}\n`], { type });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

function renderView() {
  if (state.view === "coplas") renderCoplasView();
  if (state.view === "pieces") renderPiecesView();
  if (state.view === "territory") renderTerritoryView();
  if (state.view === "submit") renderSubmitView();
  if (state.view === "media") renderMediaView();
  if (state.view === "about") renderAboutView();
}

function bindGlobalEvents() {
  document.addEventListener("click", event => {
    const nav = event.target.closest("[data-view]");
    if (nav) {
      if (normalizeView(nav.dataset.view) === "media" && nav.dataset.mediaRole) {
        state.mediaDefaultRole = nav.dataset.mediaRole;
        state.mediaModalOpen = true;
      }
      setView(nav.dataset.view);
    }
  });
  $("#collapseBtn")?.addEventListener("click", () => {
    const sidebar = $("#sidebar");
    sidebar.classList.toggle("collapsed");
    const icon = $("#collapseBtn .nav-icon");
    const label = $("#collapseBtn span:last-child");
    if (icon) icon.textContent = sidebar.classList.contains("collapsed") ? "›" : "‹";
    if (label) label.textContent = sidebar.classList.contains("collapsed") ? "Abrir" : "Contraer";
    window.setTimeout(() => state.map?.invalidateSize(), 250);
  });
  $("#clearTerritory")?.addEventListener("click", clearTerritory);
  $("#mapCardToggle")?.addEventListener("click", () => {
    setMapCardCollapsed(!$(".map-card")?.classList.contains("is-collapsed"));
  });
  $("#mapLayer")?.addEventListener("change", event => loadLayer(event.target.value));
  $("#mapSearch")?.addEventListener("input", event => renderMapSearch(event.target.value));
  $("#mapSearchBtn")?.addEventListener("click", () => {
    const query = $("#mapSearch").value;
    const firstTerritory = searchTerritories(state.territorios, query)[0];
    if (firstTerritory) selectTerritory(firstTerritory);
    else {
      state.coplaQuery = query;
      setView("coplas");
    }
  });
  $("#mapSearch")?.addEventListener("keydown", event => {
    if (event.key === "Enter") $("#mapSearchBtn").click();
  });
  all("[data-map-action]").forEach(button => button.addEventListener("click", () => {
    setView(button.dataset.mapAction === "territory" ? "territory" : "coplas");
  }));
  if (window.matchMedia?.("(max-width: 920px)").matches) setMapCardCollapsed(true);
  document.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      if (state.mediaModalOpen) {
        closeMediaModal();
        return;
      }
      closeCoplaDrawer();
      if (state.selectedTerritory && state.view === "map") clearTerritory();
    }
  });
}

async function init() {
  bindGlobalEvents();
  updateCartBadges();
  setView(normalizeView(new URL(window.location.href).searchParams.get("mode") || new URL(window.location.href).searchParams.get("view") || "map"));

  const [territorios, coplas, pezas, media] = await Promise.allSettled([
    getTerritorios(),
    getCoplas(),
    getPezas(),
    getMedia(),
  ]);
  state.territorios = territorios.status === "fulfilled" ? territorios.value : [];
  state.coplas = coplas.status === "fulfilled" ? coplas.value : [];
  state.pezas = pezas.status === "fulfilled" ? pezas.value : [];
  state.media = media.status === "fulfilled" ? media.value : [];

  if (window.L) {
    state.map = L.map("map", { zoomControl: false }).setView([42.8, -8.2], 8);
    L.control.zoom({ position: "bottomleft" }).addTo(state.map);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(state.map);
    try {
      await loadLayer("con");
    } catch (error) {
      console.error(error);
      $("#map").insertAdjacentHTML("beforeend", `<div class="map-load-error">Non se puido cargar a capa territorial.</div>`);
    }
  } else {
    $("#map").innerHTML = `<div class="map-fallback"><h2>Non se puido cargar Leaflet</h2><p>Comproba a conexión ou serve a libraría localmente.</p></div>`;
  }

  const params = new URL(window.location.href).searchParams;
  const territoryId = params.get("territory_id") || params.get("id");
  const coplaId = params.get("copla_id");
  if (territoryId) {
    const territory = state.territorios.find(item => item.id === territoryId);
    if (territory) await selectTerritory(territory);
  }
  if (coplaId) state.selectedCoplaId = Number(coplaId);

  updateMapCard();
  setView(coplaId ? "coplas" : normalizeView(params.get("mode") || params.get("view") || "map"));
  if (coplaId) openCoplaDrawer(Number(coplaId));
}

init().catch(error => {
  console.error(error);
  const active = $(".view.active");
  if (active) {
    active.insertAdjacentHTML("afterbegin", `<div class="runtime-warning">Erro parcial ao cargar: ${escapeHtml(error.message)}</div>`);
  }
});
