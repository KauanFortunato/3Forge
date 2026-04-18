# Otimizacao do Export

## Objetivo
Melhorar a pipeline de export TypeScript do 3Forge com foco em:

- estrutura mais previsivel para cenas maiores
- runtime mais eficiente para timelines
- API mais clara para controlo de animacao
- menor redundancia no codigo exportado

## O que mudou

### Timelines exportadas
- O export deixou de gerar uma funcao `buildTimelineForClip` com `switch` e construcao imperativa por clip.
- O codigo gerado agora exporta definicoes estaveis de clips (`animationClipDefinitions`) e uma ordem explicita de clips (`animationClipOrder`).
- A classe exportada passou a criar timelines sob demanda e a reutilizar a mesma instancia por clip via `timelineCache`.
- `createTimeline()` passou a funcionar como accessor neutro: cria ou devolve a timeline do clip pedido sem alterar playback por si so.
- A API de animacao passou a expor:
  - `getClipNames()`
  - `createTimeline()`
  - `playClip()`
  - `play()`
  - `pause()`
  - `restart()`
  - `reverse()`
  - `stop()`
  - `seek()`

### Reverse e replay
- O reverse deixou de depender de uma timeline infinita em loop.
- Cada clip exportado agora e finito e pode ser:
  - reiniciado com `restart()`
  - reproduzido novamente com `play()` quando ja terminou
  - revertido com `reverse()` de forma previsivel
- Quando o clip esta no inicio e o utilizador chama `reverse()`, o runtime leva o clip ao fim antes de iniciar a reproducao inversa.

### Estrutura geral do export
- A coleta de `bindings`, `fonts` e `images` foi consolidada numa etapa unica.
- Falhas de fonte ausente agora sao detectadas antes da emissao do no de texto.
- O export deixou de reconstruir a timeline so para ler metadados em `seek()`.

## Definicao tecnica adotada
- O blueprint continua a ser a fonte de verdade.
- O export transforma tracks e keyframes em uma representacao normalizada por clip:
  - `nodeId`
  - `target` (`position`, `rotation`, `scale`)
  - `key` (`x`, `y`, `z`)
  - valor inicial
  - segmentos com `at`, `duration`, `value` e `ease`
- O valor inicial de cada track e aplicado desde o tempo `0`, mesmo quando o primeiro keyframe aparece depois, para manter estado inicial e reverse previsiveis.
- A instancia do componente resolve `nodeRefs` no `build()` e so depois cria timelines para os clips realmente usados.
- Os metodos de controlo (`play`, `restart`, `reverse`, `seek`, `stop`) seguem esta ordem de escolha de clip:
  - clip explicitamente pedido
  - clip ativo atual
  - primeiro clip disponivel em `animationClipOrder`

## Ganhos praticos
- Menos recriacao de timelines ao alternar entre `play`, `seek`, `restart` e `reverse`
- Menor acoplamento entre definicao de animacao e controlo de playback
- Melhor base para cenas com mais clips e mais tracks
- Saida exportada mais facil de manter e de expandir no futuro
