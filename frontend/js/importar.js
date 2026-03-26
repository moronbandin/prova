import { getTerritorios } from "./api.js";
import { qs, nl2br } from "./utils.js";
import { mountTopNav, mountBreadcrumb } from "./nav.js";

let knownTerritoryIds = new Set();

function validatePayload(payload) {
  const errors = [];
  const warnings = [];

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    errors.push("A raíz do JSON debe ser un obxecto.");
    return { errors, warnings };
  }

  if (!Array.isArray(payload.coplas)) {
    errors.push("A clave 'coplas' debe existir e ser unha lista.");
    return { errors, warnings };
  }

  payload.coplas.forEach((copla, index) => {
    const n = index + 1;

    if (!copla || typeof copla !== "object" || Array.isArray(copla)) {
      errors.push(`Copla #${n}: debe ser un obxecto.`);
      return;
    }

    if (typeof copla.text !== "string" || !copla.text.trim()) {
      errors.push(`Copla #${n}: falta 'text' ou está baleiro.`);
    }

    if (!("notes" in copla) || typeof copla.notes !== "string") {
      errors.push(`Copla #${n}: 'notes' debe existir e ser string.`);
    }

    if (!Array.isArray(copla.tags)) {
      errors.push(`Copla #${n}: 'tags' debe ser unha lista.`);
    } else {
      copla.tags.forEach((tag, i) => {
        if (typeof tag !== "string") {
          errors.push(`Copla #${n}: etiqueta #${i + 1} non é string.`);
        }
      });
    }

    if (!Array.isArray(copla.territories)) {
      errors.push(`Copla #${n}: 'territories' debe ser unha lista.`);
    } else {
      copla.territories.forEach((t, i) => {
        if (!t || typeof t !== "object" || Array.isArray(t)) {
          errors.push(`Copla #${n}: territorio #${i + 1} non é un obxecto.`);
          return;
        }

        if (typeof t.id !== "string" || !t.id.trim()) {
          errors.push(`Copla #${n}: territorio #${i + 1} non ten 'id' válido.`);
          return;
        }

        if (!knownTerritoryIds.has(t.id)) {
          warnings.push(`Copla #${n}: territorio descoñecido ou non cargado: ${t.id}`);
        }
      });
    }
  });

  return { errors, warnings };
}

function renderValidation(errors, warnings, total = 0) {
  const out = qs("#validation-output");
  const summary = qs("#validation-summary");

  if (!errors.length && !warnings.length) {
    summary.textContent = `${total} copla(s) revisada(s) · sen erros nin avisos`;
    out.innerHTML = `<p>JSON válido.</p>`;
    return;
  }

  const parts = [];
  if (errors.length) {
    parts.push(`<h3>Erros</h3><ul>${errors.map(e => `<li>${e}</li>`).join("")}</ul>`);
  }
  if (warnings.length) {
    parts.push(`<h3>Avisos</h3><ul>${warnings.map(w => `<li>${w}</li>`).join("")}</ul>`);
  }

  summary.textContent = `${total} copla(s) revisada(s) · ${errors.length} erro(s) · ${warnings.length} aviso(s)`;
  out.innerHTML = parts.join("");
}

function renderPreview(payload) {
  const container = qs("#preview-output");
  container.innerHTML = "";

  if (!payload?.coplas?.length) {
    container.innerHTML = `<p class="muted">Sen vista previa.</p>`;
    return;
  }

  payload.coplas.forEach((copla, index) => {
    const el = document.createElement("article");
    el.className = "copla-card";

    const tags = Array.isArray(copla.tags) && copla.tags.length
      ? copla.tags.map(tag => `<span class="tag-pill">${tag}</span>`).join("")
      : `<span class="muted">sen etiquetas</span>`;

    const territories = Array.isArray(copla.territories) && copla.territories.length
      ? copla.territories.map(t => `<code>${t.id}</code>`).join(" ")
      : `<span class="muted">sen territorio</span>`;

    el.innerHTML = `
      <div class="copla-card-top">
        <strong>Copla ${index + 1}</strong>
      </div>
      <div class="copla-text">${nl2br(copla.text || "")}</div>
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
          <strong>Notas</strong>
          <span>${copla.notes || '<span class="muted">sen notas</span>'}</span>
        </div>
      </div>
    `;

    container.appendChild(el);
  });
}

async function init() {
  mountTopNav("coplas");
  mountBreadcrumb([
    { href: "../index.html", label: "Inicio" },
    { href: "./coplas.html", label: "Coplas" },
    { label: "Importar" }
  ]);

  try {
    const territorios = await getTerritorios();
    knownTerritoryIds = new Set(territorios.map(t => t.id));
  } catch {
    knownTerritoryIds = new Set();
  }

  const input = qs("#json-input");
  const validateBtn = qs("#validate-btn");
  const formatBtn = qs("#format-btn");
  const clearBtn = qs("#clear-btn");

  validateBtn?.addEventListener("click", () => {
    try {
      const payload = JSON.parse(input.value);
      const { errors, warnings } = validatePayload(payload);
      renderValidation(errors, warnings, payload.coplas?.length || 0);
      renderPreview(payload);
    } catch (err) {
      renderValidation([`JSON inválido: ${err.message}`], [], 0);
      renderPreview(null);
    }
  });

  formatBtn?.addEventListener("click", () => {
    try {
      const payload = JSON.parse(input.value);
      input.value = JSON.stringify(payload, null, 2);
    } catch (err) {
      renderValidation([`JSON inválido: ${err.message}`], [], 0);
    }
  });

  clearBtn?.addEventListener("click", () => {
    input.value = "";
    qs("#validation-summary").textContent = "";
    qs("#validation-output").innerHTML = "";
    qs("#preview-output").innerHTML = "";
  });
}

init();