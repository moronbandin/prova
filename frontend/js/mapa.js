import { getGeoLayer, getTerritorios } from "./api.js";
import { qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

let map;
let currentLayer;
let territorios = [];

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

function findTerritorioByFeature(feature, tipo) {
  const cod = getFeatureCod(feature, tipo);
  if (cod == null || Number.isNaN(cod)) return null;

  return territorios.find(t => t.tipo === tipo && Number(t.cod) === Number(cod)) || null;
}

function popupHtml(feature, tipo) {
  const nome = getFeatureNome(feature, tipo);
  const terr = findTerritorioByFeature(feature, tipo);

  if (!terr) {
    return `
      <strong>${nome}</strong><br>
      <span class="muted">Código: ${getFeatureCod(feature, tipo) ?? "descoñecido"}</span><br>
      <span class="muted">Sen correspondencia en territorios.json</span>
    `;
  }

  return `
    <strong>${terr.nome}</strong><br>
    <span class="muted">${terr.id}</span><br>
    <a href="./territorio.html?id=${encodeURIComponent(terr.id)}">Abrir territorio</a>
  `;
}

async function loadLayer(tipo = "con") {
  if (!map) return;

  if (currentLayer) {
    currentLayer.remove();
  }

  let data = await getGeoLayer(tipo);
  if (tipo === "par" && data.type === "Topology") {
    data = topoToGeo(data);
  }

  currentLayer = L.geoJSON(data, {
    style: {
      weight: 1,
      opacity: 1,
      color: "#2d6a4f",
      fillColor: "#93c5aa",
      fillOpacity: 0.18,
    },
    onEachFeature(feature, layer) {
      const terr = findTerritorioByFeature(feature, tipo);
      const nome = terr?.nome || getFeatureNome(feature, tipo);

      layer.bindPopup(popupHtml(feature, tipo));

      layer.on("mouseover", () => {
        layer.setStyle({
          weight: 2,
          color: "#1f513c",
          fillOpacity: 0.28,
        });
      });

      layer.on("mouseout", () => {
        currentLayer.resetStyle(layer);
      });

      layer.on("click", () => {
        if (terr?.id) {
          window.location.href = `./territorio.html?id=${encodeURIComponent(terr.id)}`;
        }
      });

      if (nome) {
        layer.bindTooltip(nome, {
          sticky: true,
          direction: "auto",
        });
      }
    },
  }).addTo(map);

  try {
    map.fitBounds(currentLayer.getBounds(), { padding: [20, 20] });
  } catch {}
}

async function init() {
  try {
    mountTopNav("mapa");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { label: "Mapa" }
    ]);

    const container = qs("#map");
    if (!container || !window.L) return;

    territorios = await getTerritorios();

    map = L.map("map", {
      zoomControl: true,
    }).setView([42.8, -8.2], 8);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 18,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);

    const select = qs("#layer-type");
    await loadLayer(select?.value || "con");

    select?.addEventListener("change", async () => {
      await loadLayer(select.value);
    });
  } catch (err) {
    const container = qs("#map");
    if (container) {
      container.innerHTML = `<p class="muted">${err.message}</p>`;
    }
  }
}

init();