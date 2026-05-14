# W3D Translation Playground

Sandbox para explorar a tradução W3D → blueprint do 3Forge **sem mexer no editor principal**. Aproveita o parser e walker já existentes em `src/editor/import/w3d.ts` e `src/editor/import/w3dFolder.ts`, e dá-te uma janela live para iterar sobre lógica de tradução do node tree XML.

## Para que serve

- Abrir uma pasta W3D real (ex: `C:\Users\diogo.esteves\Documents\26PT_WTV_BASKETBALL\LINEUP_LEFT`) e ver o que está lá dentro.
- Análise estrutural: contagens de tipos de element (`<Quad>`, `<TextureText>`, `<Group>`, ...), atributos únicos vistos por tipo, profundidade da árvore, lista de texturas, lista de .mov.
- Área de experimentação: uma função `translateBlueprint(xml, options)` que tu editas e que devolve um `ComponentBlueprint`. O resultado é montado num viewport Three.js minimal para veres o que sai.
- Compara o XML cru com o resultado da tradução lado a lado.

## Workflow

1. Estás na branch `exp/w3d-translation`.
2. `npm run dev:w3d-translation` — abre o playground no browser (porta `5174`).
3. Carrega numa pasta W3D. O parser mínimo extrai já os meta da Scene/SceneLayer/Camera.
4. Vais a `src/translate.ts`, editas `translateBlueprint(...)`, gravas — vite faz HMR.
5. Quando uma técnica "vence", promoves o código para `src/editor/import/w3d.ts` em commit normal (numa branch nova `feat/...`), descartas o playground (ou mantém para regressão visual).

## O que NÃO está aqui

- Não há editor de nodes nem timeline. É só "carrega XML → vê resultado".
- Não há export, save, undo. Não é o editor.
- Não há testes automáticos (escreves se quiseres em `src/editor/import/*.test.ts` quando promoveres).

## Estrutura

```
playgrounds/w3d-translation/
  README.md          ← este ficheiro
  index.html         ← entry HTML
  vite.config.mjs    ← config separada (porta + root)
  src/
    main.tsx         ← bootstrap React
    App.tsx          ← UI (folder picker, painéis, viewport)
    translate.ts     ← *** O TEU PLAYGROUND *** stub de translateBlueprint
    analyze.ts       ← análise estrutural do XML
    viewport.ts      ← Three.js scene minimal para renderizar resultado
    playground.css   ← estilos
```

## Comandos

```bash
npm run dev:w3d-translation    # arranca dev server
npm run build:w3d-translation  # build estático (raramente preciso)
```

## Notas

- Reusa tipos de `src/editor/types.ts` (caminho relativo `../../../src/editor/...`).
- Reusa parser/walker em `src/editor/import/`.
- Se quiseres adicionar testes específicos do playground, cria `playgrounds/w3d-translation/src/*.test.ts` — vitest apanha-os por defeito.
