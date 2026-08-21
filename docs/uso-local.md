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
5. Usa `Abrir folla A4 / PDF` para imprimir ou gardar como PDF desde o navegador.
6. Usa `Descargar JSON` se queres importar esa peza no corpus.
