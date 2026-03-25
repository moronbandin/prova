import { getCoplas } from "./api.js";
import { nl2br, qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

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
  return true;
}

function filterItems(items, term, territoryMode) {
  const q = term.trim().toLowerCase();

  return items.filter(item => {
    if (!matchesTerritoryFilter(item, territoryMode)) return false;

    if (!q) return true;

    const text = (item.text || "").toLowerCase();
    const incipit = (item.incipit || "").toLowerCase();
    const tags = (item.tags || []).join(" ").toLowerCase();
    const territories = (item.territories || []).map(t => t.nome).join(" ").toLowerCase();
    const notes = (item.notes || "").toLowerCase();

    return (
      text.includes(q) ||
      incipit.includes(q) ||
      tags.includes(q) ||
      territories.includes(q) ||
      notes.includes(q)
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
      .join(", ") || "sen territorio";

    const tags = (item.tags || []).length
      ? (item.tags || []).map(tag => `<span class="tag-pill">${tag}</span>`).join("")
      : `<span class="muted">sen etiquetas</span>`;

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

async function init() {
  try {
    mountTopNav("coplas");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { label: "Coplas" }
    ]);

    const items = sortItems(await getCoplas());

    const searchInput = qs("#search");
    const territorySelect = qs("#has-territory");

    function update() {
      const filtered = filterItems(
        items,
        searchInput?.value || "",
        territorySelect?.value || ""
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