import { getPezas } from "./api.js";
import { getParam, nl2br, qs } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

function renderMeta(piece) {
  qs("#meta").innerHTML = `
    <div class="meta-row"><strong>Autoría</strong><span>${piece.author || "sen autoría"}</span></div>
    <div class="meta-row"><strong>Slug</strong><span>${piece.slug}</span></div>
    <div class="meta-row"><strong>Estado</strong><span>${piece.status}</span></div>
    <div class="meta-row"><strong>Territorio</strong><span>${
      piece.context_territory
        ? `<a href="./territorio.html?id=${encodeURIComponent(piece.context_territory.id)}">${piece.context_territory.nome}</a>`
        : "sen territorio de contexto"
    }</span></div>
    <div class="meta-row"><strong>Descrición</strong><span>${piece.description || "sen descrición"}</span></div>
  `;
}

function renderCoplas(piece) {
  const list = qs("#copla-list");
  const counter = qs("#copla-count");
  list.innerHTML = "";
  counter.textContent = `${piece.coplas.length} copla${piece.coplas.length === 1 ? "" : "s"}`;

  if (!piece.coplas.length) {
    list.innerHTML = `<li class="list-item muted">Esta peza non ten coplas asociadas.</li>`;
    return;
  }

  for (const item of piece.coplas) {
    const li = document.createElement("li");
    li.className = "list-item";
    li.innerHTML = `
      <a href="./copla.html?id=${encodeURIComponent(item.id)}"><strong>${item.position}. ${item.incipit || "(sen incipit)"}</strong></a>
      <div class="copla-text">${nl2br(item.text || "")}</div>
    `;
    list.appendChild(li);
  }
}

async function init() {
  try {
    mountTopNav("pezas");
    const id = getParam("id");

    if (!id) {
      mountBreadcrumb([
        { href: "../index.html", label: "Inicio" },
        { href: "./pezas.html", label: "Pezas" },
        { label: "Peza non especificada" },
      ]);
      qs("#title").textContent = "Peza non especificada";
      return;
    }

    const pieces = await getPezas();
    const piece = pieces.find(item => String(item.id) === String(id));

    if (!piece) {
      mountBreadcrumb([
        { href: "../index.html", label: "Inicio" },
        { href: "./pezas.html", label: "Pezas" },
        { label: "Peza non atopada" },
      ]);
      qs("#title").textContent = "Peza non atopada";
      return;
    }

    mountBreadcrumb([
      { href: "../index.html", label: "Inicio" },
      { href: "./pezas.html", label: "Pezas" },
      { label: piece.title },
    ]);

    qs("#title").textContent = piece.title;
    qs("#subtitle").textContent = piece.author || "sen autoría";
    renderMeta(piece);
    renderCoplas(piece);
  } catch (err) {
    qs("#title").textContent = err.message;
  }
}

init();
