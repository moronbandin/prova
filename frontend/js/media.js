import { getMedia } from "./api.js";
import { qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

function normalize(value = "") {
  return String(value).toLowerCase();
}

function matches(item, query) {
  if (!query) return true;
  const haystack = [
    item.title,
    item.provider,
    item.media_kind,
    item.description,
    item.url,
  ]
    .filter(Boolean)
    .map(normalize)
    .join(" ");
  return haystack.includes(query);
}

function render(items) {
  const container = qs("#media-list");
  const counter = qs("#results-count");
  container.innerHTML = "";
  counter.textContent = `${items.length} resultado${items.length === 1 ? "" : "s"}`;

  if (!items.length) {
    container.innerHTML = `<p class="muted">Non hai recursos que coincidan coa busca actual.</p>`;
    return;
  }

  for (const item of items) {
    const links = (item.links || [])
      .map(link => `${link.entity_type}:${link.entity_id}`)
      .join(" · ");

    const node = document.createElement("a");
    node.className = "linked-item";
    node.href = item.url;
    node.target = "_blank";
    node.rel = "noreferrer";
    node.innerHTML = `
      <span class="linked-item-title">${item.title}</span>
      <span class="linked-item-meta">${item.provider} · ${item.media_kind}${links ? ` · ${links}` : ""}</span>
    `;
    container.appendChild(node);
  }
}

async function init() {
  try {
    mountTopNav("media");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { label: "Media" },
    ]);

    const items = await getMedia();
    const search = qs("#search");

    function update() {
      const query = normalize(search?.value || "").trim();
      render(items.filter(item => matches(item, query)));
    }

    search?.addEventListener("input", update);
    update();
  } catch (err) {
    qs("#media-list").innerHTML = `<p class="muted">${err.message}</p>`;
  }
}

init();
