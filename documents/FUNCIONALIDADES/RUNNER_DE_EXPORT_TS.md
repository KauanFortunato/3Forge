# Runner de Export TypeScript

## Objetivo

Criar um app separado, mas dentro do mesmo repositorio, para validar os arquivos `.ts` exportados pelo `3Forge` sem misturar essa responsabilidade com a UI do editor principal.

## Decisao arquitetural

Foi escolhido um playground separado em:

```text
playgrounds/export-runner
```

Isso foi preferido a integrar o runner na shell principal porque:

- o editor e o runtime de validacao tem responsabilidades diferentes
- o teste do export precisa de um ambiente simples e previsivel
- o fluxo de debug do export fica mais rapido
- evita poluir o produto principal com UI de sandbox

## Fluxo de uso

1. Exportar o componente em `.ts` no editor.
2. Colar ou salvar um ou mais arquivos em:

```text
playgrounds/export-runner/src/generated/*.ts
```

3. Rodar:

```bash
npm run dev:export-runner
```

4. Escolher o arquivo no seletor `Generated File`.
5. Clicar em `Build export` e validar:
   - se a cena monta corretamente
   - se as opcoes de runtime funcionam
   - se `play`, `pause`, `stop`, `seek` e `playClip` funcionam quando existirem

## O que o runner oferece

- deteccao automatica da classe exportada
- construcao real via `build()`
- viewport simples com `Three.js`
- `OrbitControls`
- framing automatico do conteudo
- campo JSON para testar `options`
- controles de animacao ativados conforme a API disponivel

## Observacao importante

O runner nao tenta compilar arquivos `.ts` arbitrarios escolhidos em tempo de execucao no browser. Em vez disso, ele usa um ponto de entrada conhecido e tipado dentro do repositorio. Isso deixa o fluxo mais simples, confiavel e compativel com o setup atual do projeto.
