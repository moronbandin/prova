const cache = new Map();

function isLocalFrontendMode() {
  return window.location.pathname.includes("/frontend/");
}

function isInsidePages() {
  return window.location.pathname.includes("/pages/");
}

function getDataPrefix() {
  const localFrontend = isLocalFrontendMode();
  const insidePages = isInsidePages();

  if (localFrontend) {
    return insidePages ? "../../" : "../";
  }

  return insidePages ? "../" : "./";
}

function getAssetsPrefix() {
  const localFrontend = isLocalFrontendMode();
  const insidePages = isInsidePages();

  if (localFrontend) {
    return insidePages ? "../" : "./";
  }

  return insidePages ? "../" : "./";
}

function buildPaths() {
  const dataBase = getDataPrefix();
  const assetsBase = getAssetsPrefix();

  return {
    territorios: `${dataBase}data/exports/territorios/territorios.json`,
    coplas: `${dataBase}data/exports/coplas/coplas.json`,
    pezas: `${dataBase}data/exports/pezas/pezas.json`,
    media: `${dataBase}data/exports/media/media.json`,
    geo: {
      prov: `${assetsBase}assets/web/provincias.web.geojson`,
      com: `${assetsBase}assets/web/comarcas.web.geojson`,
      con: `${assetsBase}assets/web/concellos.web.geojson`,
      par: `${assetsBase}assets/web/parroquias.web.topo.json`,
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

export async function getPezas() {
  const paths = buildPaths();
  return fetchJson(paths.pezas);
}

export async function getMedia() {
  const paths = buildPaths();
  return fetchJson(paths.media);
}

export function clearApiCache() {
  cache.clear();
}

export function getPathConfig() {
  return buildPaths();
}
