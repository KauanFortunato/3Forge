# Pivot de Group

## Objetivo

Permitir que um `Group` tenha um pivot configuravel com base no conteudo atual, sem alterar o resultado visual final do subtree no mundo.

## Definicao adotada

- O pivot de `Group` e persistido como `pivotOffset`
- Esse valor representa o deslocamento do container interno de conteudo do `Group`
- O calculo dos presets usa bounds agregados do conteudo atual do `Group` no espaco local desse conteudo
- O preset escolhido e aplicado como uma operacao explicita, nao como um comportamento dinamico que se recalcula sozinho a cada mudanca dos filhos

## Presets suportados

- `center`
- `bottom-center`
- `top-center`
- `left-center`
- `right-center`
- `front-center`
- `back-center`

## Comportamento principal

- Ao aplicar um preset, o editor calcula o novo `pivotOffset` a partir dos bounds atuais do conteudo do `Group`
- O `transform.position` do `Group` e compensado matematicamente com `rotation` e `scale`
- Os filhos diretos e indiretos preservam as mesmas posicoes visuais no mundo
- O subtree continua visualmente identico apos a mudanca do pivot
- `Group` vazio e tratado de forma segura: sem bounds, o pivot calculado volta para `0,0,0`

## UI

- O `Inspector` passou a mostrar a acao `Pivot From Content` para `Group`
- O utilizador escolhe um preset e aplica explicitamente o novo pivot
- A interface deixa claro que o layout visivel nao deve ser alterado

## Compatibilidade

- Blueprints antigos continuam compativeis
- `pivotOffset` ausente e normalizado para `0,0,0`
- A exportacao TypeScript passou a reproduzir a mesma estrutura de `Group` com container interno de conteudo

## Arquivos principais

- `src/editor/types.ts`
- `src/editor/state.ts`
- `src/editor/spatial.ts`
- `src/editor/scene.ts`
- `src/editor/exports.ts`
- `src/editor/react/App.tsx`
- `src/editor/react/components/InspectorPanel.tsx`

## Testes relacionados

- `src/editor/state.test.ts`
- `src/editor/exports.test.ts`
- `src/editor/react/components/InspectorPanel.test.tsx`
