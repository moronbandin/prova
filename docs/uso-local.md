# Uso local

## Ver a web no navegador

Desde a raíz do repo:

```bash
./serve.sh
```

Abre:

```text
http://localhost:8765/frontend/index.html
```

Este servidor tamén activa a API local:

```text
POST /api/coplas
POST /api/media
POST /api/pdf/piece-draft
GET /api/pieces/{id}/pdf
GET /api/territories/{id}/pdf
```

Iso permite que a pantalla `Alta` garde novas coplas directamente na SQLite e rexenere as exportacións web, sen descargar/importar JSON manualmente.

Se o porto está ocupado:

```bash
./serve.sh 8780
```

## Fluxo editorial básico

1. Abre `Alta`.
2. Busca o territorio polo nome se a copla está asignada.
3. Preme `Gardar na base local`.

O fluxo con JSON segue dispoñible como alternativa:

```bash
python3 tools/admin.py import-coplas ruta/ao/lote.json
```

4. Rexenera a web:

```bash
python3 tools/admin.py export-web
python3 tools/admin.py check
```

5. Publica en GitHub Pages:

```bash
git add .
git commit -m "Actualizar corpus"
git push
```

## Montar pezas e letras

1. Entra nun territorio desde o mapa ou a ficha territorial.
2. Engade coplas ao borrador.
3. Vai a `Pezas`.
4. Organiza as coplas por partes: `xota`, `muiñeira`, `pasodobre`, `valse`, `dansa`, `dous pasos`, `mazurca`, `polca`, etc.
5. Usa `Exportar PDF` para xerar un PDF real desde o servidor local e previsualizalo dentro da app.
6. Usa `Descargar JSON` se queres importar esa peza no corpus.

## Exportación PDF

A exportación PDF real é unha capacidade local/admin: require abrir Fol e Ar desde `./serve.sh`, porque GitHub Pages só serve a parte estática do arquivo.

O motor empregado é Google Chrome/Chromium en modo headless. Nun Mac con Google Chrome instalado non hai que instalar nada máis. Se queres usar outro binario:

```bash
FOL_E_AR_CHROME=/ruta/a/chromium ./serve.sh
```

Tamén podes xerar PDFs desde CLI:

```bash
python3 tools/admin.py pdf-territory par:3603002
python3 tools/admin.py pdf-piece 12 --output /tmp/peza.pdf
```

Se non se indica `--output`, o PDF escríbese en `data/exports/pdf/`.
