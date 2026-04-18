# Historico de Funcionalidades

Este arquivo regista alteracoes funcionais do projeto durante o desenvolvimento.

## Formato sugerido

Cada entrada deve indicar:

- data
- tipo da mudanca: `adicionado`, `alterado` ou `removido`
- nome curto da funcionalidade
- resumo objetivo do que mudou
- arquivos principais impactados
- testes adicionados ou atualizados, quando aplicavel

## Entradas

### 2026-04-16

- `adicionado`: Base inicial de testes
  Resumo: configurada a infraestrutura de testes com `Vitest`, `jsdom` e `React Testing Library`, com cobertura inicial para blueprint, exportacao TypeScript, materiais, fontes, imagens, animacao e componentes React criticos.
  Arquivos principais: `package.json`, `vitest.config.mjs`, `src/test/setup.ts`, `src/test/fixtures.ts`
  Testes: `src/editor/state.test.ts`, `src/editor/exports.test.ts`, `src/editor/animation.test.ts`, `src/editor/materials.test.ts`, `src/editor/fonts.test.ts`, `src/editor/images.test.ts`, `src/editor/react/components/ExportPanel.test.tsx`, `src/editor/react/components/InspectorPanel.test.tsx`

- `adicionado`: Alinhamento 3D com `Shift`
  Resumo: o modo `translate` passou a oferecer snapping por centro e bordas ao segurar `Shift`, comparando o objeto em drag com objetos irmaos no mesmo `Group` pai.
  Arquivos principais: `src/editor/alignment.ts`, `src/editor/scene.ts`
  Testes: `src/editor/alignment.test.ts`

- `adicionado`: Center In Group
  Resumo: foi adicionada uma acao explicita para alinhar o centro renderizado do objeto selecionado ao centro estrutural do `Group` pai.
  Arquivos principais: `src/editor/state.ts`, `src/editor/react/App.tsx`, `src/editor/react/components/SecondaryToolbar.tsx`
  Testes: `src/editor/state.test.ts`, `src/editor/react/components/SecondaryToolbar.test.tsx`

- `alterado`: Paste padrao de `Group` na Hierarchy
  Resumo: o paste preserva a semantica original de insercao e a `Hierarchy` agora revela automaticamente o novo `Group` colado, expandindo o path relevante sem exigir acao manual adicional.
  Arquivos principais: `src/editor/react/App.tsx`, `src/editor/react/components/SceneGraphPanel.tsx`
  Testes: `src/editor/react/components/SceneGraphPanel.test.tsx`, `src/editor/react/App.test.tsx`

- `adicionado`: Pivot configuravel para `Group`
  Resumo: `Group` passou a suportar pivot persistido via `pivotOffset`, com aplicacao explicita de presets calculados a partir dos bounds atuais do conteudo e compensacao matematica para preservar o layout visual no mundo.
  Arquivos principais: `src/editor/types.ts`, `src/editor/state.ts`, `src/editor/spatial.ts`, `src/editor/scene.ts`, `src/editor/exports.ts`, `src/editor/react/components/InspectorPanel.tsx`
  Testes: `src/editor/state.test.ts`, `src/editor/exports.test.ts`, `src/editor/react/components/InspectorPanel.test.tsx`

- `removido`: Center In Group
  Resumo: a acao de alinhar o objeto ao centro do parent foi retirada do editor, do store e da toolbar por deixar de fazer sentido no fluxo atual de pivots e groups.
  Arquivos principais: `src/editor/state.ts`, `src/editor/react/App.tsx`, `src/editor/react/components/SecondaryToolbar.tsx`
  Testes: `src/editor/state.test.ts`, `src/editor/react/components/SecondaryToolbar.test.tsx`

### 2026-04-17

- `alterado`: Shell do editor, footer e timeline
  Resumo: a timeline passou a viver num dock inferior explicito dentro da shell do editor, separando corretamente workspace, timeline e statusbar. Isso corrige o bug estrutural em que esconder a timeline deixava a UI sobrepor o footer.
  Arquivos principais: `src/editor/react/App.tsx`, `src/editor/editor.css`
  Testes: `src/editor/react/App.test.tsx`

- `alterado`: Refino de toolbar, hierarchy, inspector e empty states
  Resumo: a toolbar foi reorganizada para clarificar contexto, selecao, ferramentas e utilitarios; a hierarchy ganhou estados mais claros e melhor foco; inspector, fields, export e timeline receberam refinamentos de descoberta e orientacao.
  Arquivos principais: `src/editor/react/components/SecondaryToolbar.tsx`, `src/editor/react/components/SceneGraphPanel.tsx`, `src/editor/react/components/InspectorPanel.tsx`, `src/editor/react/components/AnimationTimeline.tsx`, `src/editor/react/components/ExportPanel.tsx`, `src/editor/react/components/FieldsPanel.tsx`, `src/editor/editor.css`
  Testes: `src/editor/react/components/SecondaryToolbar.test.tsx`

- `alterado`: Diretrizes de design do 3Forge
  Resumo: a skill de design foi atualizada para refletir regras mais especificas sobre shell do editor, docks, estados de interacao, densidade, tabs, acoes visiveis e consistencia entre paineis.
  Arquivos principais: `.agents/skills/DESIGN.md`, `documents/FUNCIONALIDADES/REFINO_UI_UX_EDITOR.md`

- `adicionado`: Export Runner para `.ts`
  Resumo: foi criado um playground separado para validar os componentes exportados em TypeScript, com viewport simples, montagem real da classe exportada, JSON de options e controles de animacao quando a API existir.
  Arquivos principais: `playgrounds/export-runner/`, `package.json`, `tsconfig.json`, `vitest.config.mjs`, `documents/FUNCIONALIDADES/RUNNER_DE_EXPORT_TS.md`
  Testes: `playgrounds/export-runner/src/runtime.test.ts`

### 2026-04-18

- `alterado`: Pipeline de export TypeScript
  Resumo: o export passou a separar definicao de clip, instanciacao de timeline e controlo de playback, substituindo a geracao imperativa por clip por definicoes estaveis com cache por timeline.
  Arquivos principais: `src/editor/exports.ts`, `src/editor/exports.test.ts`, `src/editor/exports.runtime.test.ts`, `documents/FUNCIONALIDADES/OTIMIZACAO_DO_EXPORT.md`
  Testes: `src/editor/exports.test.ts`, `src/editor/exports.runtime.test.ts`

- `alterado`: API exportada de animacao
  Resumo: os componentes exportados passaram a expor `restart()`, `reverse()` e `getClipNames()`, com `seek()` e `createTimeline()` reaproveitando timelines por clip em vez de reconstruir a estrutura a cada chamada.
  Arquivos principais: `src/editor/exports.ts`, `playgrounds/export-runner/src/runtime.ts`, `playgrounds/export-runner/src/ExportRunnerApp.tsx`
  Testes: `src/editor/exports.runtime.test.ts`, `playgrounds/export-runner/src/runtime.test.ts`

- `adicionado`: Base de PWA
  Resumo: o editor passou a gerar `manifest.webmanifest`, `service worker` para app shell e meta tags mobile/iOS para instalacao, sem assumir offline completo nesta fase.
  Arquivos principais: `vite.config.mjs`, `scripts/pwa-config.mjs`, `src/editor/pwa.ts`, `src/editor/main.tsx`, `index.html`
  Testes: `src/editor/pwa.test.ts`, `src/editor/pwa-config.test.ts`
- Reestruturado o fluxo de entrada, persistência local, recentes, Save/Save As, Exit e tratamento de clipboard permission no 3Forge.
