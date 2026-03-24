#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import os, json, re, unicodedata, sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DATA_COPLAS_DIR = os.path.join(ROOT, 'data', 'coplas')
DATA_PEZAS_DIR  = os.path.join(ROOT, 'data', 'pezas')
ASSETS_DIR      = os.path.join(ROOT, 'assets')
OUT_COPLAS      = os.path.join(ASSETS_DIR, 'coplas.json')
OUT_PEZAS       = os.path.join(ASSETS_DIR, 'pezas.json')

def slugify(s):
    s = unicodedata.normalize('NFD', s or '')
    s = ''.join(c for c in s if unicodedata.category(c) != 'Mn')
    s = re.sub(r'[^a-zA-Z0-9\-_\s]+', '', s)
    s = s.strip().replace(' ', '-').lower()
    return s or 'item'

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def parse_front_matter(md_text):
    """
    Parse front matter entre --- e ---.
    Soporta:
      - JSON: { ... }
      - key: value (listas como [a,b] ou coma-separado)
    Devolve: (meta: dict, body: str)
    """
    md_text = md_text.replace('\r\n', '\n')
    if not md_text.startswith('---'):
        return {}, md_text
    parts = md_text.split('\n', 1)
    rest = parts[1] if len(parts) > 1 else ''
    end = rest.find('\n---')
    if end == -1:
        return {}, md_text  # non pechado, devolvemos todo

    fm_block = rest[:end].strip()
    body = rest[end+4:]  # salta "\n---"
    if body.startswith('\n'):
        body = body[1:]

    # primeiro tentamos JSON
    try:
        meta = json.loads(fm_block)
        if isinstance(meta, dict):
            return meta, body
    except Exception:
        pass

    # parser simple "key: value"
    meta = {}
    for line in fm_block.split('\n'):
        if not line.strip() or line.strip().startswith('#'):
            continue
        if ':' not in line:
            continue
        k, v = line.split(':', 1)
        key = k.strip()
        val = v.strip()
        # listas JSON-like
        if val.startswith('[') and val.endswith(']'):
            try:
                meta[key] = json.loads(val)
                continue
            except Exception:
                pass
        # true/false/null/num
        if val.lower() in ('true','false','null'):
            meta[key] = json.loads(val.lower())
            continue
        try:
            if re.fullmatch(r'-?\d+(\.\d+)?', val):
                meta[key] = json.loads(val)
                continue
        except Exception:
            pass
        # coma-separado -> lista
        if ',' in val:
            items = [x.strip() for x in val.split(',') if x.strip()]
            meta[key] = items
        else:
            # quita comiñas envolventes
            if (val.startswith('"') and val.endswith('"')) or (val.startswith("'") and val.endswith("'")):
                val = val[1:-1]
            meta[key] = val
    return meta, body

def ensure_dirs():
    os.makedirs(DATA_COPLAS_DIR, exist_ok=True)
    os.makedirs(DATA_PEZAS_DIR,  exist_ok=True)
    os.makedirs(ASSETS_DIR,      exist_ok=True)

def load_coplas():
    coplas = []
    if not os.path.isdir(DATA_COPLAS_DIR):
        return coplas
    for name in os.listdir(DATA_COPLAS_DIR):
        if not name.lower().endswith('.md'):
            continue
        path = os.path.join(DATA_COPLAS_DIR, name)
        try:
            meta, body = parse_front_matter(read_file(path))
            fid = meta.get('id') or os.path.splitext(name)[0]
            fid = slugify(fid)
            loc = str(meta.get('location') or '').strip()
            etiquetas = meta.get('etiquetas') or []
            if isinstance(etiquetas, str):
                etiquetas = [etiquetas]
            item = {
                "id": fid,
                "location": loc,
                "etiquetas": etiquetas,
                "autor": meta.get('autor') or '',
                "data_recollida": meta.get('data_recollida') or '',
                "notas": meta.get('notas') or '',
                "texto": body.strip()
            }
            # tamén permitimos 'titulo' opcional (útil para ordenar)
            if 'titulo' in meta:
                item['titulo'] = str(meta['titulo'])
            coplas.append(item)
        except Exception as e:
            print(f"[WARN] Copla inválida en {path}: {e}", file=sys.stderr)
    return coplas

def load_pezas(coplas_index):
    pezas = []
    if not os.path.isdir(DATA_PEZAS_DIR):
        return pezas
    for name in os.listdir(DATA_PEZAS_DIR):
        if not name.lower().endswith('.md'):
            continue
        path = os.path.join(DATA_PEZAS_DIR, name)
        try:
            meta, body = parse_front_matter(read_file(path))
            fid = meta.get('id') or os.path.splitext(name)[0]
            fid = slugify(fid)
            loc = str(meta.get('location') or '').strip()
            etiquetas = meta.get('etiquetas') or []
            if isinstance(etiquetas, str):
                etiquetas = [etiquetas]

            title = meta.get('titulo') or meta.get('title') or fid.replace('-', ' ').title()
            ritmo = meta.get('ritmo') or ''

            # ⚠️ Nova regra: se hai texto no corpo, PRIMA e úsase tal cal
            body_text = (body or '').strip()

            comp_ids = meta.get('coplas') or []
            if isinstance(comp_ids, str):
                comp_ids = [comp_ids]
            comp_ids = [slugify(str(x)) for x in comp_ids]

            if body_text:
                texto = body_text
                componentes = comp_ids  # gardamos por se interesa como metadato
            else:
                # Sen corpo → ensamblar dende coplas (se existen)
                bloques = []
                for cid in comp_ids:
                    ref = coplas_index.get(cid)
                    if not ref:
                        print(f"[WARN] Peza {fid}: copla referenciada non atopada: {cid}", file=sys.stderr)
                        continue
                    bloques.append((ref.get('texto') or '').strip())
                texto = '\n\n'.join(bloques).strip()
                componentes = comp_ids

            item = {
                "id": fid,
                "title": str(title),
                "ritmo": str(ritmo),
                "location": loc,
                "etiquetas": etiquetas,
                "componentes": componentes,
                "texto": texto
            }
            pezas.append(item)
        except Exception as e:
            print(f"[WARN] Peza inválida en {path}: {e}", file=sys.stderr)
    return pezas

def main():
    ensure_dirs()
    coplas = load_coplas()

    # Index por id para resolver pezas -> coplas
    coplas_idx = {c['id']: c for c in coplas}

    pezas  = load_pezas(coplas_idx)

    # Ordenación simple:
    #  - coplas por 'titulo' se existe, senón pola primeira liña do texto
    def first_line(s): 
        return (s or '').splitlines()[0] if s else ''
    coplas.sort(key=lambda c: (c.get('titulo') or first_line(c.get('texto')) or '').lower())
    pezas.sort(key=lambda p: (p.get('title') or '').lower())

    with open(OUT_COPLAS, 'w', encoding='utf-8') as f:
        json.dump(coplas, f, ensure_ascii=False, indent=2)

    with open(OUT_PEZAS, 'w', encoding='utf-8') as f:
        json.dump(pezas, f, ensure_ascii=False, indent=2)

    print(f"[OK] {len(coplas)} coplas → {OUT_COPLAS}")
    print(f"[OK] {len(pezas)} pezas → {OUT_PEZAS}")

if __name__ == '__main__':
    main()