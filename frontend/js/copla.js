import { getCoplas } from "./api.js";
import { getParam, nl2br, qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

function renderTerritories(item) {
  const container = qs("#territories");
  const territories = item.territories || [];

  if (!territories.length) {
    container.innerHTML = `<p class="muted">Sen territorio vinculado.</p>`;
    return;
  }

  container.innerHTML = territories.map(t => `
    <a class="linked-item" href="./territorio.html?id=${encodeURIComponent(t.id)}">
      <span class="linked-item-title">${t.nome}</span>
      <span class="linked-item-meta">${t.tipo} · ${t.id}</span>
    </a>
  `).join("");
}

function renderTags(item) {
  const container = qs("#tags");
  const tags = item.tags || [];

  if (!tags.length) {
    container.innerHTML = `<span class="muted">Sen etiquetas</span>`;
    return;
  }

  container.innerHTML = tags.map(tag => `
    <span class="tag-pill">${tag}</span>
  `).join("");
}

function renderNotes(item) {
  const el = qs("#notes");
  if (!item.notes) {
    el.innerHTML = `<p class="muted">Sen notas.</p>`;
    return;
  }

  el.innerHTML = `<p>${item.notes}</p>`;
}

function renderVersions(item) {
  const container = qs("#versions");
  const counter = qs("#versions-count");
  const versions = item.versions || [];
  if (!container) return;

  if (counter) {
    counter.textContent = `${versions.length} versión${versions.length === 1 ? "" : "s"}`;
  }

  if (!versions.length) {
    container.innerHTML = `<p class="muted">Sen variantes rexistradas. O texto principal funciona como versión canónica.</p>`;
    return;
  }

  container.innerHTML = versions.map(version => `
    <article class="linked-item">
      <span class="linked-item-title">${version.label || version.incipit || "Versión"}</span>
      <div class="copla-text">${nl2br(version.text)}</div>
      ${version.notes ? `<span class="linked-item-meta">${version.notes}</span>` : ""}
    </article>
  `).join("");
}

function renderCopla(item) {
  qs("#title").textContent = item.incipit || `Copla ${item.id}`;
  qs("#subtitle").textContent = item.incipit ? "Ficha individual da copla" : "Rexistro individual";
  qs("#copla-id").textContent = `#${item.id}`;
  qs("#text").innerHTML = nl2br(item.text);

  renderTerritories(item);
  renderVersions(item);
  renderTags(item);
  renderNotes(item);
}

async function init() {
  try {
    const id = getParam("id");

    if (!id) {
      mountTopNav("coplas");
      mountBreadcrumb([
        { href: "../index.html", label: "Inicio" },
        { href: "./coplas.html", label: "Coplas" },
        { label: "Copla non especificada" }
      ]);
      qs("#title").textContent = "Copla non especificada";
      qs("#subtitle").textContent = "";
      return;
    }

    const items = await getCoplas();
    const item = items.find(c => String(c.id) === String(id));

    if (!item) {
      mountTopNav("coplas");
      mountBreadcrumb([
        { href: "../index.html", label: "Inicio" },
        { href: "./coplas.html", label: "Coplas" },
        { label: "Copla non atopada" }
      ]);
      qs("#title").textContent = "Copla non atopada";
      qs("#subtitle").textContent = "";
      return;
    }

    mountTopNav("coplas");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { href: "./coplas.html", label: "Coplas" },
      { label: item.incipit || `Copla #${item.id}` }
    ]);

    renderCopla(item);
  } catch (err) {
    mountTopNav("coplas");
    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { href: "./coplas.html", label: "Coplas" },
      { label: "Erro" }
    ]);
    qs("#title").textContent = err.message;
    qs("#subtitle").textContent = "";
  }
}

init();
