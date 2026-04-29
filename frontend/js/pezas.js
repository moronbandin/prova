import { getPezas } from "./api.js";
import { qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

function normalize(value = "") {
  return String(value).toLowerCase();
}

function matches(item, query) {
  if (!query) return true;
  const parts = [
    item.title,
    item.author,
    item.description,
    item.context_territory?.nome,
    item.context_territory?.id,
  ]
    .filter(Boolean)
    .map(normalize)
    .join(" ");
  return parts.includes(query);
}

function render(items) {
  const container = qs("#piece-list");
  const counter = qs("#results-count");
  container.innerHTML = "";
  counter.textContent = `${items.length} resultado${items.length === 1 ? "" : "s"}`;

  if (!items.length) {
    container.innerHTML = `<p class="muted">Non hai pezas que coincidan coa busca actual.</p>`;
    return;
  }

  for (const item of items) {
    const node = document.createElement("a");
    node.className = "linked-item";
    node.href = `./peza.html?id=${encodeURIComponent(item.id)}`;
    node.innerHTML = `
      <span class="linked-item-title">${item.title}</span>
      <span class="linked-item-meta">
        ${item.author || "sen autoría"} · ${item.copla_count} copla${item.copla_count === 1 ? "" : "s"}
        ${item.context_territory?.nome ? ` · ${item.context_territory.nome}` : ""}
      </span>
    `;
    container.appendChild(node);
  }
}

async function init() {
  try {
    mountTopNav("pezas");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { label: "Pezas" },
    ]);

    const items = await getPezas();
    const search = qs("#search");

    function update() {
      const query = normalize(search?.value || "").trim();
      render(items.filter(item => matches(item, query)));
    }

    search?.addEventListener("input", update);
    update();
  } catch (err) {
    qs("#piece-list").innerHTML = `<p class="muted">${err.message}</p>`;
  }
}

init();
