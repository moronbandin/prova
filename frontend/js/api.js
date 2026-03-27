const cache = new Map();

function isLocalFrontendMode() {
  return window.location.pathname.includes("/frontend/");
}

function getBasePrefix() {
  return isLocalFrontendMode() ? "../../" : "../";
}

function buildPaths() {
  const base = getBasePrefix();

  return {
    territorios: `${base}data/exports/territorios/territorios.json`,
    coplas: `${base}data/exports/coplas/coplas.json`,
    geo: {
      prov: `${base}assets/web/provincias.web.geojson`,
      com: `${base}assets/web/comarcas.web.geojson`,
      con: `${base}assets/web/concellos.web.geojson`,
      par: `${base}assets/web/parroquias.web.topo.json`,
    },
  };
}

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
  const paths = buildPaths();
  return fetchJson(paths.territorios);
}

export async function getCoplas() {
  const paths = buildPaths();
  return fetchJson(paths.coplas);
}

export async function getGeoLayer(tipo) {
  const paths = buildPaths();
  const path = paths.geo[tipo];

  if (!path) {
    throw new Error(`Tipo de capa non soportado: ${tipo}`);
  }

  return fetchJson(path);
}

export function clearApiCache() {
  cache.clear();
}

export function getPathConfig() {
  return buildPaths();
}