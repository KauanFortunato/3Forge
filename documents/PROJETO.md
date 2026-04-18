# 3Forge

## O que e o projeto

O `3Forge` e um editor 3D construido com `Three.js`, `React` e `TypeScript`. O objetivo do projeto e permitir a criacao, edicao, organizacao e exportacao de cenas e componentes 3D de forma visual, dentro de uma interface de editor.

Em vez de montar tudo manualmente no codigo, o utilizador pode compor a cena dentro do editor e depois exportar esse resultado para ser reutilizado em outros projetos baseados em `three`.

## O que o editor faz

O editor permite:

- criar e organizar nodes 3D em estrutura hierarquica
- editar transformacoes como posicao, rotacao e escala
- configurar geometrias e materiais
- trabalhar com texto 3D
- importar imagens
- usar fontes
- marcar propriedades como editaveis em runtime
- visualizar tudo dentro de uma viewport 3D

## Como o projeto representa a cena

O `3Forge` usa um formato interno chamado `blueprint`.

Esse `blueprint` representa a estrutura completa do componente ou cena, incluindo:

- nome do componente
- lista de fontes usadas
- lista de nodes
- relacao hierarquica entre os nodes
- propriedades de transform
- configuracoes de geometria
- configuracoes de material
- bindings editaveis

Na pratica, o `blueprint` e o formato de dados do projeto dentro do editor.

## Exportacoes do projeto

O editor suporta dois formatos principais de saida:

### 1. Blueprint em JSON

O `blueprint` pode ser exportado em `.json`.

Esse arquivo serve para:

- salvar o projeto
- reabrir o projeto depois
- transportar a cena entre ambientes
- manter a estrutura completa editavel dentro do editor

Esse e o formato de persistencia do trabalho.

### 2. Classe TypeScript para Three.js

O editor tambem gera uma classe em `TypeScript` para uso com `three`.

Essa classe:

- cria um `Group`
- reconstrui a hierarquia da cena
- instancia geometrias, materiais, imagens e textos
- aplica transformacoes
- expoe opcoes editaveis em runtime
- possui ciclo de `build()` e `dispose()`

Na pratica, o resultado e um componente de codigo que pode ser integrado diretamente em projetos com `Three.js`.

## Fluxo principal do 3Forge

O fluxo esperado do projeto e:

1. O utilizador monta a cena visualmente no editor.
2. O editor guarda a estrutura em formato de `blueprint`.
3. O projeto pode ser salvo como `.json`.
4. O mesmo `blueprint` pode ser convertido para uma classe TypeScript.
5. Essa classe pode ser usada em aplicacoes que trabalham com `three`.

## Resumo

O `3Forge` e um editor visual de cenas e componentes 3D que transforma composicao visual em dois ativos principais:

- um `blueprint` JSON para salvar e reabrir projetos
- uma classe TypeScript baseada em `Three.js` para usar a cena no codigo

Ou seja, ele funciona ao mesmo tempo como ferramenta de autoria visual e como gerador de componentes 3D reutilizaveis.

## Documentacao funcional

O registo de funcionalidades do projeto fica em `documents/FUNCIONALIDADES`.

- `documents/FUNCIONALIDADES/README.md`: convencao para documentar novas funcionalidades
- `documents/FUNCIONALIDADES/HISTORICO.md`: historico interno do que foi adicionado, alterado ou removido
