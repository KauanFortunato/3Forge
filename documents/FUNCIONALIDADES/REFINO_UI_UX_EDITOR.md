# Refino de UI/UX do Editor

## Objetivo

Elevar a interface do `3Forge` para um patamar mais profissional sem trocar a identidade visual existente. O foco desta revisão foi:

- fortalecer a shell do editor
- corrigir o bug estrutural entre timeline e footer
- melhorar legibilidade e hierarquia do chrome principal
- reduzir inconsistencias entre painéis
- reforçar estados e feedback da interface

## O que mudou

### 1. Shell e dock inferior

- O layout do editor deixou de depender de uma grid plana com timeline e footer como siblings fragis.
- A timeline agora vive num dock inferior explicito dentro de `app-shell__body`.
- O footer/statusbar voltou a ter uma posicao estrutural estavel e separada do dock da timeline.
- Esconder a timeline agora colapsa a regiao certa sem sobrepor o footer.

### 2. Toolbar principal

- A toolbar passou a separar melhor:
  - contexto do projeto
  - contexto da selecao
  - ferramentas de transformacao
  - modos de viewport
  - utilitarios e historico
- O toggle da timeline agora comunica estado diretamente: `Timeline On` / `Timeline Off`.
- A leitura da toolbar ficou menos “achatada” e mais proxima de software de autoria.

### 3. Hierarchy

- Os rows ganharam estados mais claros de selecao e ancestralidade.
- A densidade ficou menos apertada.
- Acoes importantes deixaram de depender totalmente de hover.
- Foram adicionadas melhores semanticas de teclado/foco no tree.

### 4. Inspector e paineis secundarios

- O `Inspector` ficou mais descobrivel com tabs rotuladas visualmente, sem depender apenas de icones.
- Empty states ficaram mais orientados e menos neutros.
- O `ExportPanel` ganhou header interno com mais contexto.
- `FieldsPanel` e `AnimationTimeline` passaram a sugerir melhor o proximo passo do utilizador.

### 5. Sistema visual

- Foi reforcado um pequeno sistema de consistencia com:
  - alturas de controle
  - espacamento estrutural
  - header heights
  - focus ring consistente
- Estados `focus-visible` foram adicionados para controles principais.

## Causa raiz do bug timeline/footer

O bug nao era de `z-index`. A shell do editor usava uma grid superior com linhas condicionais para timeline/splitter, mas o footer nao tinha um contrato estrutural isolado do dock inferior. Quando a timeline era escondida, a distribuicao dos tracks ficava fragil e o footer podia acabar visualmente coberto pelo conteudo do editor.

A correcao foi estrutural:

- footer mantido como regiao fixa da shell
- timeline movida para um dock inferior proprio
- separacao entre layout do workspace e layout do dock

## Resultado esperado

- footer sempre legivel e fora da area da timeline
- shell previsivel com paineis visiveis ou ocultos
- toolbar, hierarchy e inspector mais coerentes
- interface mais proxima de apps 3D e creative tools profissionais
