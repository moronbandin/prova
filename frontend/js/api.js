const PATHS = {
  territorios: "../data/exports/territorios/territorios.json",
  coplas: "../data/exports/coplas/coplas.json",
  geo: {
    prov: "../assets/web/provincias.web.geojson",
    com: "../assets/web/comarcas.web.geojson",
    con: "../assets/web/concellos.web.geojson",
    par: "../assets/web/parroquias.web.topo.json",
  },
};

const cache = new Map();

function resolvePath(path) {
  return new URL(path, window.location.href).toString();
}

async function fetchJson(path) {
  const resolved = resolvePath(path);

  if (cache.has(resolved)) {
    return cache.get(resolved);
  }

  const promise = fetch(resolved).then(async (res) => {
    if (!res.ok) {
      throw new Error(`Non se puido cargar ${path}`);
    }
    return res.json();
  });

  cache.set(resolved, promise);
  return promise;
}

export async function getTerritorios() {
  return fetchJson(PATHS.territorios);
}

export async function getCoplas() {
  return fetchJson(PATHS.coplas);
}

export async function getGeoLayer(tipo) {
  const path = PATHS.geo[tipo];
  if (!path) {
    throw new Error(`Tipo de capa non soportado: ${tipo}`);
  }
  return fetchJson(path);
}

export function clearApiCache() {
  cache.clear();
}

export function getPathConfig() {
  return structuredClone(PATHS);
}