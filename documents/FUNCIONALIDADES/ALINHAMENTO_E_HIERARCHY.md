# Alinhamento e Hierarchy

## Objetivo

Adicionar ferramentas de alinhamento espacial mais previsiveis no editor e corrigir o fluxo de copy/paste de `Group` para que a `Hierarchy` reflita o resultado imediatamente.

## Funcionalidades

### 1. Snapping com `Shift` durante drag 3D

- O snapping atua apenas no modo `translate`
- O comportamento entra em acao quando o utilizador segura `Shift` durante o drag
- O objeto movido tenta alinhar centro e bordas com objetos irmaos no mesmo `Group` pai
- O alinhamento usa bounding box em world space para manter previsibilidade visual
- O resultado final continua a ser persistido como transform local no `blueprint`

### 2. Copy/Paste de `Group` na Hierarchy

- O comportamento original de paste foi preservado: ao colar com um `Group` selecionado, a insercao continua a acontecer dentro dele
- A `Hierarchy` agora expande automaticamente o path e o node selecionado apos o paste, para que a nova copia apareca de imediato
- Isso corrige o bug visual sem alterar a semantica do comando de paste

## Arquivos principais

- `src/editor/alignment.ts`
- `src/editor/scene.ts`
- `src/editor/state.ts`
- `src/editor/react/App.tsx`
- `src/editor/react/components/SceneGraphPanel.tsx`
- `src/editor/react/components/SecondaryToolbar.tsx`

## Testes relacionados

- `src/editor/alignment.test.ts`
- `src/editor/state.test.ts`
- `src/editor/react/components/SecondaryToolbar.test.tsx`
- `src/editor/react/components/SceneGraphPanel.test.tsx`
- `src/editor/react/App.test.tsx`
