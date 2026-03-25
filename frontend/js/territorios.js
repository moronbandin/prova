import { getTerritorios } from "./api.js";
import { qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

const TYPE_LABELS = {
  prov: "Provincias",
  com: "Comarcas",
  con: "Concellos",
  par: "Parroquias",
};

function sortItems(items) {
  return [...items].sort((a, b) => {
    const byType = (a.tipo || "").localeCompare(b.tipo || "", "gl");
    if (byType !== 0) return byType;
    return (a.nome || "").localeCompare(b.nome || "", "gl");
  });
}

function filterItems(items, term, tipo) {
  const q = term.trim().toLowerCase();

  return items.filter(item => {
    const matchesTipo = !tipo || item.tipo === tipo;
    if (!matchesTipo) return false;

    if (!q) return true;

    return (
      (item.nome || "").toLowerCase().includes(q) ||
      (item.search || "").toLowerCase().includes(q) ||
      (item.id || "").toLowerCase().includes(q) ||
      String(item.cod || "").includes(q)
    );
  });
}

function groupByTipo(items) {
  const groups = {
    prov: [],
    com: [],
    con: [],
    par: [],
  };

  for (const item of items) {
    if (groups[item.tipo]) {
      groups[item.tipo].push(item);
    }
  }

  return groups;
}

function createCard(item) {
  const article = document.createElement("article");
  article.className = "territory-card";

  article.innerHTML = `
    <a class="territory-card-link" href="./territorio.html?id=${encodeURIComponent(item.id)}">
      <div class="territory-card-top">
        <h3>${item.nome}</h3>
        <span class="territory-badge">${item.tipo}</span>
      </div>
      <div class="territory-card-meta">
        <span><strong>ID</strong> <code>${item.id}</code></span>
        <span><strong>Código</strong> ${item.cod}</span>
      </div>
    </a>
  `;

  return article;
}

function renderGroups(items) {
  const container = qs("#territory-groups");
  const counter = qs("#results-count");

  container.innerHTML = "";
  counter.textContent = `${items.length} resultado${items.length === 1 ? "" : "s"}`;

  if (!items.length) {
    container.innerHTML = `
      <div class="empty-state">
        <p>Non hai territorios que coincidan coa busca actual.</p>
      </div>
    `;
    return;
  }

  const grouped = groupByTipo(items);

  for (const tipo of ["prov", "com", "con", "par"]) {
    const groupItems = grouped[tipo];
    if (!groupItems.length) continue;

    const section = document.createElement("section");
    section.className = "territory-group";

    const header = document.createElement("div");
    header.className = "section-head";
    header.innerHTML = `
      <h2 class="section-title">${TYPE_LABELS[tipo]}</h2>
      <p class="muted">${groupItems.length}</p>
    `;

    const grid = document.createElement("div");
    grid.className = "territory-grid";

    for (const item of groupItems.sort((a, b) => (a.nome || "").localeCompare(b.nome || "", "gl"))) {
      grid.appendChild(createCard(item));
    }

    section.appendChild(header);
    section.appendChild(grid);
    container.appendChild(section);
  }
}

async function init() {
  try {
    mountTopNav("territorios");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { label: "Territorios" }
    ]);

    const items = sortItems(await getTerritorios());

    const searchInput = qs("#search");
    const tipoSelect = qs("#tipo");

    function update() {
      const filtered = filterItems(
        items,
        searchInput?.value || "",
        tipoSelect?.value || ""
      );
      renderGroups(filtered);
    }

    searchInput?.addEventListener("input", update);
    tipoSelect?.addEventListener("change", update);

    update();
  } catch (err) {
    qs("#territory-groups").innerHTML = `<div class="empty-state"><p>${err.message}</p></div>`;
  }
}

init();