import { slugify } from "./utils.js";

const STORAGE_KEY = "coplas-piece-draft-v1";
export const RHYTHM_OPTIONS = [
  "xota",
  "muiñeira",
  "pasodobre",
  "valse",
  "dansa",
  "dous pasos",
  "mazurca",
  "polca",
  "rumba",
  "alalá",
  "outro",
];

function defaultDraft() {
  return {
    title: "",
    author: "",
    context_territory_id: "",
    description: "",
    notes: "",
    status: "draft",
    coplas: [],
    sections: [
      { id: "section-1", label: "xota", coplas: [] },
      { id: "section-2", label: "muiñeira", coplas: [] },
    ],
  };
}

function normalizeCoplaItem(item, index) {
  return {
    id: Number(item.id),
    incipit: item.incipit || "",
    text: item.text || "",
    territory_ids: Array.isArray(item.territory_ids) ? item.territory_ids : [],
    position: index + 1,
  };
}

function normalizeDraft(raw) {
  const base = defaultDraft();
  if (!raw || typeof raw !== "object") {
    return base;
  }

  const legacyCoplas = Array.isArray(raw.coplas)
    ? raw.coplas
        .filter(item => item && typeof item === "object" && item.id != null)
        .map(normalizeCoplaItem)
    : [];

  const rawSections = Array.isArray(raw.sections) && raw.sections.length
    ? raw.sections
    : [{ id: "section-1", label: raw.section_label || "xota", coplas: legacyCoplas }];

  const sections = rawSections.map((section, sectionIndex) => ({
    id: section.id || `section-${sectionIndex + 1}`,
    label: section.label || (sectionIndex === 1 ? "muiñeira" : "xota"),
    coplas: Array.isArray(section.coplas)
      ? section.coplas
          .filter(item => item && typeof item === "object" && item.id != null)
          .map(normalizeCoplaItem)
      : [],
  }));

  const flatCoplas = sections.flatMap(section => section.coplas);

  return {
    ...base,
    ...raw,
    sections,
    coplas: flatCoplas.map((item, index) => ({ ...item, position: index + 1 })),
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
  const patch = {};
  if (!draft.context_territory_id) patch.context_territory_id = territoryId;
  if (!draft.title && territoryId) patch.title = "";
  return Object.keys(patch).length ? updateDraftMeta(patch) : draft;
}

export function addSection(label = "xota") {
  const draft = loadDraft();
  return saveDraft({
    ...draft,
    sections: [
      ...draft.sections,
      { id: `section-${Date.now()}`, label, coplas: [] },
    ],
  });
}

export function updateSection(sectionId, patch) {
  const draft = loadDraft();
  return saveDraft({
    ...draft,
    sections: draft.sections.map(section =>
      section.id === sectionId ? { ...section, ...patch } : section
    ),
  });
}

export function removeSection(sectionId) {
  const draft = loadDraft();
  if (draft.sections.length <= 1) return draft;
  return saveDraft({
    ...draft,
    sections: draft.sections.filter(section => section.id !== sectionId),
  });
}

export function addCoplaToDraft(copla, sectionId = null) {
  const draft = loadDraft();
  const exists = draft.sections.some(section =>
    section.coplas.some(item => Number(item.id) === Number(copla.id))
  );
  if (exists) return draft;
  const targetId = sectionId || draft.sections[0]?.id;

  return saveDraft({
    ...draft,
    sections: draft.sections.map(section => section.id === targetId
      ? {
          ...section,
          coplas: [
            ...section.coplas,
            {
              id: Number(copla.id),
              incipit: copla.incipit || "",
              text: copla.text || "",
              territory_ids: Array.isArray(copla.territories)
                ? copla.territories.map(item => item.id)
                : [],
            },
          ],
        }
      : section
    ),
  });
}

export function removeCoplaFromDraft(coplaId) {
  const draft = loadDraft();
  return saveDraft({
    ...draft,
    sections: draft.sections.map(section => ({
      ...section,
      coplas: section.coplas.filter(item => Number(item.id) !== Number(coplaId)),
    })),
  });
}

export function moveCoplaInDraft(coplaId, direction, sectionId = null) {
  const draft = loadDraft();
  const nextSections = draft.sections.map(section => {
    if (sectionId && section.id !== sectionId) return section;
    const index = section.coplas.findIndex(item => Number(item.id) === Number(coplaId));
    if (index < 0) return section;

    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= section.coplas.length) return section;

    const nextCoplas = [...section.coplas];
    const [item] = nextCoplas.splice(index, 1);
    nextCoplas.splice(target, 0, item);
    return { ...section, coplas: nextCoplas };
  });

  return saveDraft({
    ...draft,
    sections: nextSections,
  });
}

export function moveCoplaToSection(coplaId, targetSectionId) {
  const draft = loadDraft();
  let moving = null;
  const stripped = draft.sections.map(section => {
    const index = section.coplas.findIndex(item => Number(item.id) === Number(coplaId));
    if (index < 0) return section;
    const coplas = [...section.coplas];
    [moving] = coplas.splice(index, 1);
    return { ...section, coplas };
  });

  if (!moving) return draft;

  return saveDraft({
    ...draft,
    sections: stripped.map(section => section.id === targetSectionId
      ? { ...section, coplas: [...section.coplas, moving] }
      : section
    ),
  });
}

export function getFirstSectionId() {
  return loadDraft().sections[0]?.id || "section-1";
}

export function countDraftCoplas(draft = loadDraft()) {
  return draft.sections.reduce((total, section) => total + section.coplas.length, 0);
}

export function getCoplaSectionId(coplaId) {
  const draft = loadDraft();
  const section = draft.sections.find(item =>
    item.coplas.some(copla => Number(copla.id) === Number(coplaId))
  );
  return section?.id || "";
}

export function flattenDraftCoplas(draft = loadDraft()) {
  return draft.sections.flatMap(section =>
    section.coplas.map(copla => ({ ...copla, section_label: section.label }))
  );
}

export function buildPrintableHtml(territorios = []) {
  const draft = loadDraft();
  const territory = territorios.find(item => item.id === draft.context_territory_id);
  const title = draft.title.trim() || territory?.nome || "Peza sen título";
  const author = draft.author.trim() || "Sen autoría";
  const sections = draft.sections.filter(section => section.coplas.length);

  const escape = (value = "") => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const lines = (value = "") => escape(value).replace(/\n/g, "<br>");

  return `<!doctype html>
<html lang="gl">
<head>
  <meta charset="utf-8">
  <title>${escape(title)}</title>
  <style>
    @page { size: A4; margin: 16mm; }
    * { box-sizing: border-box; }
    body { margin: 0; font-family: Avenir Next, Segoe UI, sans-serif; color: #1d2326; }
    header { margin-bottom: 12mm; border-bottom: 1px solid #ccd6d0; padding-bottom: 5mm; }
    h1 { margin: 0 0 2mm; font-size: 24pt; letter-spacing: 0; }
    .meta { color: #5b666b; font-size: 10pt; }
    .sheet { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; align-items: start; }
    section { break-inside: avoid; }
    h2 { margin: 0 0 4mm; font-size: 13pt; text-transform: uppercase; letter-spacing: 0.08em; color: #0e6b77; }
    article { margin: 0 0 5mm; break-inside: avoid; }
    .incipit { margin-bottom: 1mm; font-weight: 700; font-size: 10pt; }
    .text { font-family: Georgia, Times New Roman, serif; font-size: 11pt; line-height: 1.45; white-space: pre-line; }
    .empty { color: #5b666b; }
  </style>
</head>
<body>
  <header>
    <h1>${escape(title)}</h1>
    <div class="meta">${escape(author)}${territory ? ` · ${escape(territory.nome)}` : ""}</div>
  </header>
  <main class="sheet">
    ${sections.length ? sections.map(section => `
      <section>
        <h2>${escape(section.label || "parte")}</h2>
        ${section.coplas.map(copla => `
          <article>
            <div class="incipit">${escape(copla.incipit || "(sen incipit)")}</div>
            <div class="text">${lines(copla.text || "")}</div>
          </article>
        `).join("")}
      </section>
    `).join("") : `<p class="empty">A peza aínda non ten coplas seleccionadas.</p>`}
  </main>
</body>
</html>`;
}

export function openPrintablePiece(territorios = []) {
  const html = buildPrintableHtml(territorios);
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const win = window.open(url, "_blank", "noopener");
  if (!win) {
    const link = document.createElement("a");
    link.href = url;
    link.download = "peza-a4.html";
    link.click();
  } else {
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export function downloadPrintablePiece(territorios = []) {
  const html = buildPrintableHtml(territorios);
  const draft = loadDraft();
  const title = draft.title.trim() || "peza";
  const blob = new Blob([html], { type: "text/html" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `${slugify(title) || "peza"}-a4.html`;
  link.click();
  URL.revokeObjectURL(link.href);
}

export function draftHasCopla(coplaId) {
  return loadDraft().sections.some(section =>
    section.coplas.some(item => Number(item.id) === Number(coplaId))
  );
}

export function buildPieceImportPayload() {
  const draft = loadDraft();
  const cleanTitle = draft.title.trim();
  const generatedSlug = slugify(cleanTitle || "peza");

  let position = 0;
  const coplas = draft.sections.flatMap(section =>
    section.coplas.map(item => {
      position += 1;
      return {
        copla_id: Number(item.id),
        position,
        section_label: section.label || null,
      };
    })
  );

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
        coplas,
      },
    ],
  };
}
export function clearDraft() {
  const draft = defaultDraft();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  return draft;
}
