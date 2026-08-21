import { getCoplas, getTerritorios } from "./api.js";
import { getParam, nl2br, qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";
import { getDescendantIds } from "./territory_data.js";

function sortItems(items) {
  return [...items].sort((a, b) => {
    const aKey = (a.incipit || a.text || "").toLowerCase();
    const bKey = (b.incipit || b.text || "").toLowerCase();
    return aKey.localeCompare(bKey, "gl");
  });
}

function matchesTerritoryFilter(item, territoryMode) {
  const hasTerritory = (item.territories || []).length > 0;

  if (!territoryMode) return true;
  if (territoryMode === "with") return hasTerritory;
  if (territoryMode === "without") return !hasTerritory;
  if (territoryMode === "unassigned") return item.territory_state === "unassigned";
  if (territoryMode === "general") return item.territory_state === "general";
  return true;
}

function filterItems(items, term, territoryMode, allowedTerritoryIds = null) {
  const q = term.trim().toLowerCase();
  const allowed = allowedTerritoryIds ? new Set(allowedTerritoryIds) : null;

  return items.filter(item => {
    if (!matchesTerritoryFilter(item, territoryMode)) return false;
    if (allowed && !(item.territories || []).some(t => allowed.has(t.id))) return false;

    if (!q) return true;

    const text = (item.text || "").toLowerCase();
    const incipit = (item.incipit || "").toLowerCase();
    const tags = (item.tags || []).join(" ").toLowerCase();
    const territories = (item.territories || []).map(t => t.nome).join(" ").toLowerCase();
    const notes = (item.notes || "").toLowerCase();
    const versions = (item.versions || [])
      .map(version => [version.label, version.text, version.notes].filter(Boolean).join(" "))
      .join(" ")
      .toLowerCase();

    return (
      text.includes(q) ||
      incipit.includes(q) ||
      tags.includes(q) ||
      territories.includes(q) ||
      notes.includes(q) ||
      versions.includes(q)
    );
  });
}

function renderList(items) {
  const ul = qs("#copla-list");
  const counter = qs("#results-count");
  ul.innerHTML = "";

  counter.textContent = `${items.length} resultado${items.length === 1 ? "" : "s"}`;

  if (!items.length) {
    ul.innerHTML = `
      <li class="empty-state">
        <p>Non hai coplas que coincidan coa busca actual.</p>
      </li>
    `;
    return;
  }

  for (const item of items) {
    const territories = (item.territories || [])
      .map(t => `<a href="./territorio.html?id=${encodeURIComponent(t.id)}">${t.nome}</a>`)
      .join(", ") || (
        item.territory_state === "general"
          ? "copla xeral"
          : item.territory_state === "unassigned"
            ? "territorio descoñecido / non adscrita"
            : "sen territorio"
      );

    const tags = (item.tags || []).length
      ? (item.tags || []).map(tag => `<span class="tag-pill">${tag}</span>`).join("")
      : `<span class="muted">sen etiquetas</span>`;
    const versionCount = (item.versions || []).length;

    const li = document.createElement("li");
    li.className = "copla-card";

    li.innerHTML = `
      <div class="copla-card-top">
        <a class="copla-card-title" href="./copla.html?id=${encodeURIComponent(item.id)}">
          <strong>${item.incipit || "(sen incipit)"}</strong>
        </a>
        <span class="copla-id">#${item.id}</span>
      </div>

      <div class="copla-text">${nl2br(item.text)}</div>

      <div class="meta-stack">
        <div class="meta-row">
          <strong>Territorios</strong>
          <span>${territories}</span>
        </div>
        <div class="meta-row">
          <strong>Etiquetas</strong>
          <span class="tag-row">${tags}</span>
        </div>
        <div class="meta-row">
          <strong>Versións</strong>
          <span>${versionCount ? `${versionCount} variante${versionCount === 1 ? "" : "s"}` : "sen variantes"}</span>
        </div>
        ${
          item.notes
            ? `
          <div class="meta-row">
            <strong>Notas</strong>
            <span>${item.notes}</span>
          </div>
        `
            : ""
        }
      </div>
    `;

    ul.appendChild(li);
  }
}

function renderTerritoryContext(territory, territorios, allowedTerritoryIds) {
  const card = qs("#territory-context-card");
  if (!card || !territory) return;

  const descendants = Math.max(allowedTerritoryIds.length - 1, 0);
  qs("#territory-context-title").textContent = `Coplas de ${territory.nome}`;
  qs("#territory-context-copy").textContent = descendants
    ? `Esta vista inclúe tamén o contido absorbido polos ${descendants} subterritorio(s) que dependen de ${territory.nome}.`
    : `Esta vista mostra só as coplas vinculadas directamente a ${territory.nome}.`;
  const link = qs("#territory-context-link");
  link.href = `./territorio.html?id=${encodeURIComponent(territory.id)}`;
  card.hidden = false;
}

async function init() {
  try {
    mountTopNav("coplas");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { label: "Coplas" }
    ]);

    const territoryId = getParam("territory_id");
    const [items, territorios] = await Promise.all([
      getCoplas(),
      getTerritorios(),
    ]);
    const sortedItems = sortItems(items);
    let allowedTerritoryIds = null;

    if (territoryId) {
      const territory = territorios.find(item => item.id === territoryId);
      if (territory) {
        allowedTerritoryIds = getDescendantIds(territory, territorios);
        renderTerritoryContext(territory, territorios, allowedTerritoryIds);
      }
    }

    const searchInput = qs("#search");
    const territorySelect = qs("#has-territory");

    function update() {
      const filtered = filterItems(
        sortedItems,
        searchInput?.value || "",
        territorySelect?.value || "",
        allowedTerritoryIds
      );
      renderList(filtered);
    }

    searchInput?.addEventListener("input", update);
    territorySelect?.addEventListener("change", update);

    update();
  } catch (err) {
    mountTopNav("coplas");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { label: "Coplas" }
    ]);
    qs("#copla-list").innerHTML = `<li class="empty-state"><p>${err.message}</p></li>`;
  }
}

init();
