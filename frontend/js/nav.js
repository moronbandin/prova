import { qs } from "./utils.js";

function isInsidePages() {
  return window.location.pathname.includes("/pages/");
}

function makeHref(target) {
  const insidePages = isInsidePages();

  const map = {
    home: insidePages ? "../index.html" : "./index.html",
    mapa: insidePages ? "../index.html?mode=map" : "./index.html?mode=map",
    territorios: insidePages ? "../index.html?mode=map" : "./index.html?mode=map",
    coplas: insidePages ? "../index.html?mode=coplas" : "./index.html?mode=coplas",
    pezas: insidePages ? "../index.html?mode=pieces" : "./index.html?mode=pieces",
    media: insidePages ? "../index.html?mode=media" : "./index.html?mode=media",
    admin: insidePages ? "../index.html?mode=alta" : "./index.html?mode=alta",
  };

  return map[target] || target;
}

const NAV_ITEMS = [
  { hrefKey: "home", label: "Inicio", key: "home" },
  { hrefKey: "mapa", label: "Mapa", key: "mapa" },
  { hrefKey: "territorios", label: "Territorios", key: "territorios" },
  { hrefKey: "coplas", label: "Coplas", key: "coplas" },
  { hrefKey: "pezas", label: "Pezas", key: "pezas" },
  { hrefKey: "media", label: "Media", key: "media" },
  { hrefKey: "admin", label: "Alta", key: "admin" },
];

function buildNav(current = "") {
  return `
    <nav class="topnav" aria-label="Navegación principal">
      <div class="topnav-inner">
        <a class="topnav-brand" href="${makeHref("home")}">Fol e ar</a>
        <div class="topnav-links">
          ${NAV_ITEMS.map(item => `
            <a class="topnav-link ${item.key === current ? "is-active" : ""}" href="${makeHref(item.hrefKey)}">
              ${item.label}
            </a>
          `).join("")}
        </div>
      </div>
    </nav>
  `;
}

function buildBreadcrumb(items = []) {
  if (!items.length) return "";

  return `
    <nav class="breadcrumbs" aria-label="Breadcrumb">
      <ol class="breadcrumbs-list">
        ${items.map((item, index) => `
          <li class="breadcrumbs-item">
            ${
              item.href && index < items.length - 1
                ? `<a href="${item.href}">${item.label}</a>`
                : `<span aria-current="page">${item.label}</span>`
            }
          </li>
        `).join("")}
      </ol>
    </nav>
  `;
}

export function mountTopNav(current = "") {
  const target = qs("#site-nav");
  if (!target) return;
  target.innerHTML = buildNav(current);
}

export function mountBreadcrumb(items = []) {
  const target = qs("#breadcrumbs");
  if (!target) return;
  target.innerHTML = buildBreadcrumb(items);
}
