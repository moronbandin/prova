// js/peza.js
async function fetchJSON(path){
    const res = await fetch(path);
    if (!res.ok) throw new Error(`Erro cargando ${path}`);
    return res.json();
  }
  function esc(s){ return String(s||''); }
  
  function getParam(name){
    const u = new URL(location.href);
    return u.searchParams.get(name);
  }
  
  (async function main(){
    const id = getParam('id');
    if (!id){
      document.getElementById('title').textContent = 'Peza non especificada';
      document.getElementById('texto').textContent = '';
      return;
    }
  
    try {
      const pezas = await fetchJSON('../assets/pezas.json');
      const peza = pezas.find(p => String(p.id) === String(id));
      if (!peza){
        document.getElementById('title').textContent = 'Peza non atopada';
        document.getElementById('texto').textContent = '';
        return;
      }
  
      document.getElementById('title').textContent = esc(peza.title || peza.id);
      const metaBits = [];
      if (peza.ritmo) metaBits.push(`Ritmo: ${esc(peza.ritmo)}`);
      if (peza.location) metaBits.push(`Localización: ${esc(peza.location)}`);
      document.getElementById('meta').textContent = metaBits.join(' · ');
  
      const tagsEl = document.getElementById('tags');
      tagsEl.innerHTML = (peza.etiquetas || []).map(t => `<span class="tag">${esc(t)}</span>`).join('');
  
      const texto = String(peza.texto || '').trim();
      document.getElementById('texto').textContent = texto || '(sen texto)';
    } catch (e) {
      document.getElementById('title').textContent = 'Erro cargando peza';
      document.getElementById('texto').textContent = String(e);
      console.error(e);
    }
  })();