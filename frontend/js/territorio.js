import { getTerritorios, getCoplas, getGeoLayer } from "./api.js";
import { getParam, nl2br, qs, territoryLabel } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

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
    `;
    ul.appendChild(li);
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

    const [territorios, coplas] = await Promise.all([
      getTerritorios(),
      getCoplas(),
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

    renderTerritoryInfo(territorio, hierarchy, children);
    renderCoplas(relatedCoplas);
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