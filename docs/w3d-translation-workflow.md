# W3D Translation — Workflow & Branch Model

Documento de onboarding para quem entra a meio. Explica **as duas branches**, **o que está em cada uma**, e **como iterar** sem quebrar o trabalho oficial.

## Visão geral

A importação de scenes W3D (`scene.w3d`) está a ser construída em **duas frentes paralelas**:

```
main
 └── feat/r3-support          ← trabalho oficial / produção
       └── exp/w3d-translation ← sandbox de exploração (playground)
```

| Branch | Para que serve | Quando mexo aqui? |
|--------|----------------|-------------------|
| `feat/r3-support` | Código que vai chegar ao editor real. Testes obrigatórios, typecheck obrigatório. | Quando uma técnica do playground está madura e pronta para produção. |
| `exp/w3d-translation` | Sandbox para experimentar tradução XML → blueprint. **Sem responsabilidade de qualidade**. | Sempre que estou a descobrir como traduzir algo (Quad, TextureText, animações, etc.). |

**Regra de ouro**: nunca toco em `src/editor/` na branch de exploração. Toda a experimentação fica em `playgrounds/w3d-translation/src/`. Quando algo funciona bem, **promovo para `feat/r3-support`** em commit separado.

---

## O que já está pronto em `feat/r3-support`

Fases A→E concluídas (todas commitadas, 489 testes a passar):

| Fase | Commit | O que entrou |
|------|--------|--------------|
| A | `b49cf27` | Modo 2D do viewport: ortho fixo, sem zoom/pan, letterbox 1920x1080, toggle 2D/3D na toolbar |
| B | `1f51e9c` | Tipos mínimos da w3d: `EngineViewportSettings`, `EngineCameraSettings`, `ImportMetadata`, etc. |
| C | `0d39554` | Botão "Import W3D Folder" no menu File, walker do folder, parser **mínimo** do `scene.w3d` (só Scene/SceneLayer/Camera) |
| D | `3713cbc` | Pipeline `.mov` completa: vite plugin que corre ffmpeg, sequenceSchema/Hash/Folder, conversão backend |
| E | `9194f94` | Texturas raster (PNG/JPG/WEBP/SVG) do W3D vão para `blueprint.images` |

Mais commits de correcções pequenas em cima (toggle Ortho/Perspective no Settings, rename Images→Media, etc.).

**O que falta** (= Fase F = o trabalho que está no playground):
- Traduzir o `<SceneNode>` e filhos (Quad, TextureText, Group, Disk, …) para `EditorNode`s
- Traduzir `<Resources><BaseMaterial>` para `MaterialAsset`
- Traduzir `<Resources><TextureLayer>` para algo equivalente
- Traduzir `<Timelines><KeyFrameAnimationController>` para `AnimationClip`/`AnimationTrack`
- Traduzir `<ExportManagerProperties>` para `ExposedProperty`

---

## O que está em `exp/w3d-translation`

Tudo o de `feat/r3-support` **mais** o playground:

```
playgrounds/w3d-translation/
  README.md           ← README mais detalhado do playground
  index.html
  vite.config.mjs     ← porta 5174, config independente
  src/
    main.tsx          ← bootstrap React
    App.tsx           ← UI (folder picker, painéis Structure/XML/Blueprint, viewport)
    translate.ts      ← *** AQUI MEXES *** stub de translateBlueprint(xml)
    analyze.ts        ← análise estrutural (contagens de tipos, atributos únicos)
    viewport.ts       ← Three.js minimal para renderizar o blueprint resultante
    playground.css
```

Scripts adicionados ao `package.json`:
```bash
npm run dev:w3d-translation    # arranca playground em http://localhost:5174
npm run build:w3d-translation
npm run preview:w3d-translation
```

Também levantei o `playgrounds/export-runner/` com algumas QoL: validação JSON live, format JSON, toggles grid/background, bounds W×H×D após build.

---

## Loop diário (sandbox)

```bash
git checkout exp/w3d-translation
npm run dev:w3d-translation
```

Browser abre em :5174. Clica **"Open W3D folder…"** → escolhe o folder W3D (ex: `C:\Users\diogo.esteves\Documents\26PT_WTV_BASKETBALL\LINEUP_LEFT`).

Vês 3 painéis tabbed:
- **Structure**: lista de elements XML, contagens, atributos únicos, sample paths. ROI imediato para descobrir o que existe.
- **Raw XML**: XML cru, podes copiar.
- **Blueprint**: JSON do `ComponentBlueprint` que `translate.ts` produziu.

Mexes em `translate.ts`, gravas, HMR recarrega. Botão **"Re-translate"** força nova passagem contra o XML carregado (útil se HMR não pega).

**Recomendação de ordem**:
1. `<Resources><BaseMaterial>` → `blueprint.materials` (4 itens neste sample)
2. `<Resources><Texture>` → mapeia GUID → `blueprint.images[].id` já existente
3. `<Resources><TextureLayer>` → decisão de design (inline no material vs novo asset type)
4. 1 tipo de node: `<Quad>` → `EditorNode { type: "plane" }`
5. `<Group>` → recursão
6. `<TextureText>` → `EditorNode { type: "text" }`
7. Animações (`<KeyFrameAnimationController>`)
8. ExposedProperties (`<ExportProperty>`)

Cada passo independente, podes parar onde quiseres.

---

## Promover do playground para produção

Quando uma técnica está estável no playground:

```bash
# 1. Sai do sandbox para a base
git checkout feat/r3-support

# 2. Cria branch dedicada para esta promoção
git checkout -b feat/w3d-translate-materials   # exemplo

# 3. Copia a lógica madura de playgrounds/w3d-translation/src/translate.ts
#    para src/editor/import/w3d.ts (adapta ao estilo do parser oficial)

# 4. Escreve testes em src/editor/import/w3d.test.ts

# 5. Valida
npm run typecheck
npm test

# 6. Commit no padrão tipo(scope): mensagem
git commit -m "feat(import): translate w3d base materials"

# 7. Push e PR
git push -u origin feat/w3d-translate-materials
```

A branch `exp/w3d-translation` continua viva como sandbox de longo prazo (para a próxima iteração).

---

## Convenções de commit

Padrão **conventional commits** simplificado:

```
tipo(scope): descrição em minúsculas, imperativo, < 70 chars
```

Tipos usados neste projeto:

| Tipo | Quando |
|------|--------|
| `feat` | Funcionalidade nova visível ao utilizador |
| `fix` | Bug corrigido |
| `refactor` | Mudança interna sem alterar comportamento |
| `docs` | Documentação / READMEs |
| `test` | Apenas testes |
| `chore` | Tooling, configs, dependências |

Scopes comuns: `scene`, `import`, `ui`, `settings`, `playground`, `export`, `state`, `viewport`.

Exemplos do histórico actual:
```
feat(playground): w3d translation sandbox
fix(import): ortographic projection forces 2d mode
refactor(ui): rename Images panel to Media
feat(settings): camera projection and canvas size controls
```

**Não fazer**: mensagens vagas tipo `update`, `wip`, `fixes`, `more changes`. Cada commit deve descrever o **porquê** (o **o quê** já está no diff).

---

## Sincronizar entre máquinas

Em casa (primeira vez):
```bash
git fetch
git checkout feat/r3-support && git pull
git checkout exp/w3d-translation && git pull
```

Em casa (regular):
```bash
git pull              # na branch actual
```

Antes de mudar de branch, garante working tree limpa:
```bash
git status            # devia mostrar nada
git stash             # se tiver mudanças não-commited e querer mudar de branch
```

---

## Comandos cheat-sheet

```bash
# Branches
git checkout exp/w3d-translation       # sandbox
git checkout feat/r3-support           # trabalho oficial
git branch -v                          # lista branches locais

# Playground (sandbox)
npm run dev:w3d-translation            # porta 5174 ← daily driver da exploração
npm run dev:export-runner              # porta 5173 (validar exports TS)
npm run dev                            # editor principal

# Validação
npm run typecheck                      # TS sem erros
npm test                               # vitest suite (489 testes hoje)
npm run validate                       # typecheck + test + build

# Git
git log --oneline -10                  # últimos 10 commits
git status                             # working tree
git push                               # branch já tem upstream
git push -u origin <branch>            # primeira vez
```

---

## Notas para o próximo passo

A próxima sessão deve focar **`<Resources><BaseMaterial>` → `MaterialAsset`** no playground. O scene `LINEUP_LEFT` tem 4 materials simples (Emissive based). Snippet de starter está no histórico de mensagens — basta colar no `translate.ts` antes do `return`.

Quando os 4 materials aparecerem na tab Blueprint, passo seguinte é mapear `<Texture>` para os `blueprint.images` já populados pelo Phase E (matching por filename).
