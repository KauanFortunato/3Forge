# Phase A — 2D viewport mode with fixed canvas (1920×1080)

## Context

Tradução faseada do branch deletado `feat/w3d-scene-support` para `feat/r3-support`. Plano global tem fases A→F:

- **A (este plano)**: modo 2D do viewport + canvas size + toggle 2D/3D. Nenhuma dependência da branch w3d — só código local.
- B: tipos mínimos da w3d (`SceneMode` já entra em A, restantes ficam para B)
- C: file btn import W3D + walker + parser mínimo do scene.w3d (Scene/SceneLayer/Camera só, sem children)
- D: pipeline .mov completa (vite plugin + sequence schema/hash/folder + backend converter)
- E: textures raster do W3D folder → ImageAssetsPanel
- F (utilizador faz): tradução XML do node tree (Quad/TextureText/Group/animações/masks)

O objectivo desta fase é criar a "área de trabalho" para o utilizador conseguir continuar as fases seguintes — em particular, ter um viewport 2D estável (aspect-ratio fixo, câmara central sem zoom/pan) onde, depois, a importação W3D possa renderizar consistentemente com o original. O viewport 3D actual continua a existir e fica selecionável via toggle.

**Nota importante**: foi feito um edit prematuro a `src/editor/types.ts` (`SceneSettings` ganhou os campos `mode: SceneMode` e `canvas: SceneCanvasSize` como obrigatórios) antes do plan mode ativar. Esse edit isolado quebra compilação TS até state.ts ser actualizado. O plano abaixo reconcilia esse estado completando as restantes mudanças.

## Requisitos confirmados com o utilizador

1. Substituir o viewport atual por dois modos: 3D (como está, perspective + OrbitControls + TransformControls) e 2D (orthographic, câmara fixa centrada, sem zoom/pan).
2. Tamanho da scene vem do project, default 1920×1080, com aspect-ratio fixo (X ou Y) e letterbox/pillarbox quando o container muda.
3. Câmara 2D não pode mover-se nem dar zoom.
4. Toggle entre 2D e 3D visível na UI (utilizador escolheu SecondaryToolbar implicitamente — onde já existe o toggle de shading).

## Implementation

### 1. `src/editor/types.ts` ([já parcialmente editado](src/editor/types.ts))

Já adicionado:
```ts
export type SceneMode = "2d" | "3d";
export interface SceneCanvasSize { width: number; height: number; }
// SceneSettings agora tem mode: SceneMode; canvas: SceneCanvasSize;
```

Nada mais a mudar neste ficheiro.

### 2. `src/editor/state.ts`

- `createDefaultSceneSettings()` (~linha 274): devolver também `mode: "3d"` e `canvas: { width: 1920, height: 1080 }`.
- `normalizeSceneSettings()` (~linha 697): normalizar `mode` (aceitar `"2d"`/`"3d"`, fallback `"3d"`) e `canvas` (clamp positivo, defaults 1920/1080).
- `updateSceneSettings()` patch type (~linha 1444): adicionar `mode?: SceneMode; canvas?: Partial<SceneCanvasSize>`.

Aproveitar helpers existentes: `normalizeNumber`, `clampNumber`.

### 3. `src/editor/scene.ts`

Mudanças mínimas (sem refactor invasivo dos transform/raycaster — esses ficam ligados à perspective camera, que continua a ser `this.camera`. A `activeCamera` muda só no `render()` e na configuração do viewport):

- **Imports**: adicionar `OrthographicCamera` à lista do `three`.
- **Estado**:
  - `private readonly orthoCamera: OrthographicCamera`
  - `private currentSceneMode: SceneMode = "3d"`
  - `private viewportRect2D = { x: 0, y: 0, width: 0, height: 0 }`
- **Constructor**: criar `orthoCamera` com frustum default (ver `applyOrthoFrustum()` abaixo), posição `(0, 0, 10)`, lookAt origem. Inicializar `currentSceneMode` de `store.sceneSettings.mode`. Aplicar modo ao final do construtor (após `rebuildScene()`).
- **Novo método `applyOrthoFrustum(aspect: number)`**: define `left/right/top/bottom` do ortho para `height = 10` scene units, `width = 10 * aspect`. `near = 0.1`, `far = 100`.
- **`resize()` (linha 1440)**: dividir em dois ramos.
  - 3D: lógica actual.
  - 2D: calcular rect letterboxed dentro do container baseado em `sceneSettings.canvas.width/height`. Guardar em `viewportRect2D`. Configurar `applyOrthoFrustum(canvas.width / canvas.height)`. `renderer.setSize(containerW, containerH)` mantém-se.
- **`startLoop()` → `tick()` (linha 1451)**: ramificar render por modo.
  - 3D: `renderer.render(scene, this.camera)` (como agora).
  - 2D: `renderer.setScissorTest(true); renderer.setViewport(rect); renderer.setScissor(rect); renderer.setClearColor(letterboxColor, 1); renderer.clear(); renderer.render(scene, orthoCamera); renderer.setScissorTest(false);`
  - Em 2D, **não** renderizar `orientationRenderer`.
- **`handleStoreChange()`**: quando reason for `"sceneSettings"`, ler `store.sceneSettings.mode` e `canvas`. Se mode mudou, chamar `applySceneMode(newMode)`. Se canvas mudou, chamar `resize()`.
- **Novo método `applySceneMode(mode: SceneMode)`**:
  - Guarda `this.currentSceneMode = mode`.
  - Se 2D: `orbitControls.enabled = false`; esconder `infiniteGrid`, axes helpers, orientation gizmo DOM element (`style.display = "none"`); `transformControls.showZ = false`; chamar `resize()`.
  - Se 3D: reverter — `orbitControls.enabled = true`; mostrar grid/axes/gizmo; `transformControls.showZ = true`; `resize()`.
- **`dispose()`**: nada novo necessário.

Raycaster e selecção: ficam ligados a `this.camera` (perspective). Em 2D isto significa que cliques são raycasted no espaço 3D mesmo que renderizemos em ortho — não ideal, mas aceitável para Fase A; corrige-se quando entrar conteúdo W3D real (Fase C+). Documentar como TODO no comentário do `applySceneMode`.

### 4. `src/editor/react/components/SecondaryToolbar.tsx`

Adicionar props:
```ts
sceneMode?: SceneMode;
onSceneModeChange?: (mode: SceneMode) => void;
```

Renderizar antes do shading toggle (linha ~201, dentro de `toolbar__right`):
```tsx
{onSceneModeChange && sceneMode ? (
  <div className="tgroup tgroup--mode" aria-label="Scene mode">
    <ToolbarIconButton label="2D" isActive={sceneMode === "2d"} onClick={() => onSceneModeChange("2d")}>
      <span style={{ fontSize: 10, fontWeight: 600 }}>2D</span>
    </ToolbarIconButton>
    <ToolbarIconButton label="3D" isActive={sceneMode === "3d"} onClick={() => onSceneModeChange("3d")}>
      <span style={{ fontSize: 10, fontWeight: 600 }}>3D</span>
    </ToolbarIconButton>
  </div>
) : null}
```

(Pode ser substituído por ícone próprio depois — Fase A só precisa de label legível.)

Importar `SceneMode` de `../../types`.

### 5. `src/editor/react/App.tsx`

No render que monta `SecondaryToolbar` (linhas ~3247 e ~3280 — há dois sites), passar:
```tsx
sceneMode={sceneSettings.mode}
onSceneModeChange={(mode) => store.updateSceneSettings({ mode })}
```

`sceneSettings` já vem do snapshot do store (verificar via `useEditorStoreSnapshot` ou via referência directa — confirmar no momento).

### 6. CSS opcional (`src/editor/editor.css`)

Confirmar que `.vp` (viewport container) tem background neutro para as letterbox bars (`#000` ou `var(--bg-panel)`). Provavelmente já tem — não tocar a menos que pareça mal.

## Files to modify

- `src/editor/types.ts` (já editado)
- `src/editor/state.ts` (default + normalize + patch)
- `src/editor/scene.ts` (ortho camera + letterbox + mode switch)
- `src/editor/react/components/SecondaryToolbar.tsx` (toggle UI)
- `src/editor/react/App.tsx` (wire toggle)

## Verification

1. **TypeScript**: `npm run build` (ou equivalente) compila sem erros.
2. **Tests existentes**: `npm test -- src/editor/state.test.ts src/editor/scene.test.ts` passam sem regressões. Adicionar novos test cases:
   - `state.test.ts`: defaults têm `mode: "3d"` e `canvas: 1920x1080`. `updateSceneSettings({ mode: "2d" })` actualiza. `normalizeSceneSettings` com input legacy (sem mode/canvas) devolve defaults.
3. **Manual no browser** (`npm run dev`):
   - App carrega como 3D por defeito (regressão zero no comportamento actual).
   - Toggle 2D no SecondaryToolbar: viewport letterboxed para 16:9 (1920/1080). Grid desaparece, gizmo de orientação desaparece, OrbitControls não responde a drag/zoom.
   - Redimensionar uma panel lateral (alargar/encolher viewport): canvas 2D mantém aspect 16:9 com bars laterais ou superiores conforme container.
   - Toggle 3D: viewport volta a estado anterior — câmara/grid/gizmo intactos.
4. **Edge cases**:
   - Container ultra-estreito (panels todas abertas): scene size encolhe mas mantém aspect.
   - Trocar para 2D, dar reload da página: persiste em 2D (via `sceneSettings` no blueprint serializado).

## Out of scope (deixar para fases B–E)

- Raycaster/picking adaptado para ortho 2D (afecta selecção; corrigir quando F entrar)
- UI para editar `canvas.width/height` (Settings Dialog) — defaults chegam para A
- Cores diferentes para letterbox bars
- Persistência da última escolha de mode entre sessões fora do blueprint
- W3D import, .mov pipeline, textures (B–E)
