import { slugify } from "./utils.js";

const STORAGE_KEY = "coplas-piece-draft-v1";

function defaultDraft() {
  return {
    title: "",
    author: "",
    context_territory_id: "",
    description: "",
    notes: "",
    status: "draft",
    coplas: [],
  };
}

function normalizeDraft(raw) {
  const base = defaultDraft();
  if (!raw || typeof raw !== "object") {
    return base;
  }

  return {
    ...base,
    ...raw,
    coplas: Array.isArray(raw.coplas)
      ? raw.coplas
          .filter(item => item && typeof item === "object" && item.id != null)
          .map((item, index) => ({
            id: Number(item.id),
            incipit: item.incipit || "",
            text: item.text || "",
            territory_ids: Array.isArray(item.territory_ids) ? item.territory_ids : [],
            position: index + 1,
          }))
      : [],
  };
}

export function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultDraft();
    return normalizeDraft(JSON.parse(raw));
  } catch {
    return defaultDraft();
  }
}

export function saveDraft(draft) {
  const normalized = normalizeDraft(draft);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}

export function updateDraftMeta(patch) {
  return saveDraft({
    ...loadDraft(),
    ...patch,
  });
}

export function ensureContextTerritory(territoryId) {
  const draft = loadDraft();
  if (draft.context_territory_id) return draft;
  return updateDraftMeta({ context_territory_id: territoryId });
}

export function addCoplaToDraft(copla) {
  const draft = loadDraft();
  const exists = draft.coplas.some(item => Number(item.id) === Number(copla.id));
  if (exists) return draft;

  return saveDraft({
    ...draft,
    coplas: [
      ...draft.coplas,
      {
        id: Number(copla.id),
        incipit: copla.incipit || "",
        text: copla.text || "",
        territory_ids: Array.isArray(copla.territories)
          ? copla.territories.map(item => item.id)
          : [],
      },
    ],
  });
}

export function removeCoplaFromDraft(coplaId) {
  const draft = loadDraft();
  return saveDraft({
    ...draft,
    coplas: draft.coplas.filter(item => Number(item.id) !== Number(coplaId)),
  });
}

export function moveCoplaInDraft(coplaId, direction) {
  const draft = loadDraft();
  const index = draft.coplas.findIndex(item => Number(item.id) === Number(coplaId));
  if (index < 0) return draft;

  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= draft.coplas.length) return draft;

  const next = [...draft.coplas];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item);

  return saveDraft({
    ...draft,
    coplas: next,
  });
}

export function clearDraft() {
  const draft = defaultDraft();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  return draft;
}

export function draftHasCopla(coplaId) {
  return loadDraft().coplas.some(item => Number(item.id) === Number(coplaId));
}

export function buildPieceImportPayload() {
  const draft = loadDraft();
  const cleanTitle = draft.title.trim();
  const generatedSlug = slugify(cleanTitle || "peza");

  return {
    pieces: [
      {
        title: cleanTitle || "Peza sen título",
        slug: generatedSlug || "peza",
        author: draft.author.trim() || "Sen autoría",
        context_territory_id: draft.context_territory_id || null,
        description: draft.description || "",
        notes: draft.notes || "",
        status: draft.status || "draft",
        coplas: draft.coplas.map((item, index) => ({
          copla_id: Number(item.id),
          position: index + 1,
        })),
      },
    ],
  };
}
