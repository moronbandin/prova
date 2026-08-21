import { normalizeText } from "./utils.js";

export const TYPE_LABELS = {
  prov: "Provincia",
  com: "Comarca",
  con: "Concello",
  par: "Parroquia",
};

export function buildHierarchy(territorio, all) {
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

export function getChildren(territorio, all) {
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

export function getDescendantIds(territorio, all) {
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

export function filterCoplasByTerritory(coplas, territoryIds) {
  const ids = new Set(territoryIds);
  return coplas.filter(copla =>
    (copla.territories || []).some(t => ids.has(t.id))
  );
}

export function filterPiecesByTerritory(pieces, territoryIds, coplas) {
  const ids = new Set(territoryIds);
  const relatedCoplaIds = new Set(coplas.map(item => item.id));

  return pieces.filter(piece => {
    if (piece.context_territory?.id && ids.has(piece.context_territory.id)) {
      return true;
    }

    return (piece.coplas || []).some(item => relatedCoplaIds.has(item.id));
  });
}

export function filterMediaByContext(mediaItems, territoryIds, coplas, pieces) {
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

export function getFeatureCod(feature, tipo) {
  const p = feature?.properties || {};

  if (tipo === "prov") return Number(p.CODPROV ?? p.cod ?? p.CODIGO ?? p.COD);
  if (tipo === "com") return Number(p.CODCOM ?? p.cod ?? p.CODIGO ?? p.COD);
  if (tipo === "con") return Number(p.CODCONC ?? p.cod ?? p.CODIGO ?? p.COD);
  if (tipo === "par") return Number(p.CODPARRO ?? p.CODPARR ?? p.cod ?? p.CODIGO ?? p.COD);

  return null;
}

export function getFeatureNome(feature, tipo) {
  const p = feature?.properties || {};

  if (tipo === "prov") return p.PROVINCIA || p.NOME || p.nome || p.NAME || "Territorio";
  if (tipo === "com") return p.COMARCA || p.NOME || p.nome || p.NAME || "Territorio";
  if (tipo === "con") return p.CONCELLO || p.NOME || p.nome || p.NAME || "Territorio";
  if (tipo === "par") return p.PARROQUIA || p.NOME || p.nome || p.NAME || "Territorio";

  return p.NOME || p.nome || p.NAME || "Territorio";
}

export function findTerritoryByFeature(feature, tipo, territorios) {
  const cod = getFeatureCod(feature, tipo);
  if (cod == null || Number.isNaN(cod)) return null;

  return territorios.find(t => t.tipo === tipo && Number(t.cod) === Number(cod)) || null;
}

export function searchTerritories(territorios, term) {
  const q = normalizeSearchText(term || "");
  if (!q) return [];

  const scored = territorios.map(item => {
    const nome = normalizeSearchText(item.nome || "");
    const search = buildSearchCorpus(item);
    const id = normalizeSearchText(item.id || "");
    const cod = String(item.cod || "");

    let score = -1;
    if (nome === q) score = 100;
    else if (search.split(" | ").includes(q)) score = 95;
    else if (id === q) score = 90;
    else if (nome.startsWith(q)) score = 80;
    else if (search.startsWith(q)) score = 70;
    else if (nome.includes(q)) score = 60;
    else if (search.includes(q)) score = 50;
    else if (cod.includes(q)) score = 40;
    else if (id.includes(q)) score = 30;

    return { item, score };
  }).filter(entry => entry.score >= 0);

  return scored
    .sort((a, b) => b.score - a.score || (a.item.nome || "").localeCompare(b.item.nome || "", "gl"))
    .slice(0, 18)
    .map(entry => entry.item);
}

function normalizeSearchText(text = "") {
  return normalizeText(text)
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(santa|santo|san|sao|sª|sta)\b/g, " ")
    .replace(/\b(a|o|as|os|de|da|do|das|dos)\b/g, " ")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchCorpus(item) {
  const variants = new Set([
    item.nome,
    item.search,
    item.slug,
    item.id,
    String(item.cod || ""),
  ].filter(Boolean).map(normalizeSearchText));

  const withoutArticles = normalizeSearchText(item.nome || "");
  if (withoutArticles) variants.add(withoutArticles);

  return Array.from(variants).filter(Boolean).join(" | ");
}
