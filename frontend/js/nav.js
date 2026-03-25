import { qs } from "./utils.js";

function isHomePage() {
  const path = window.location.pathname;
  return path.endsWith("/frontend/") || path.endsWith("/frontend/index.html");
}

function makeHref(target) {
  const home = isHomePage();

  const map = {
    home: home ? "./index.html" : "../index.html",
    mapa: home ? "./pages/mapa.html" : "./mapa.html",
    territorios: home ? "./pages/territorios.html" : "./territorios.html",
    coplas: home ? "./pages/coplas.html" : "./coplas.html",
    pezas: home ? "./pages/pezas.html" : "./pezas.html",
  };

  return map[target] || target;
}

const NAV_ITEMS = [
  { hrefKey: "home", label: "Inicio", key: "home" },
  { hrefKey: "mapa", label: "Mapa", key: "mapa" },
  { hrefKey: "territorios", label: "Territorios", key: "territorios" },
  { hrefKey: "coplas", label: "Coplas", key: "coplas" },
  { hrefKey: "pezas", label: "Pezas", key: "pezas" },
];

function buildNav(current = "") {
  return `
    <nav class="topnav" aria-label="Navegación principal">
      <div class="topnav-inner">
        <a class="topnav-brand" href="${makeHref("home")}">Coplas Galegas</a>
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