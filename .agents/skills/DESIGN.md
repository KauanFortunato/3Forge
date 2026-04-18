---
name: Design-Skill-Local
description: Usada para qualquer coisa que será feita de frontend no app
---

# DESIGN

## Objetivo

Atuar como especialista de design para o `3Forge`, sempre respeitando a identidade visual atual do produto. Esta skill deve ser usada em qualquer tarefa ligada a UI, UX visual, sistema de design, layout, componentes, paines, toolbar, viewport, landing page, empty states, modais, menus, tabelas, formularios e refinamento estetico.

## Contexto do Produto

O `3Forge` e uma ferramenta de autoria e edicao 3D. A interface deve parecer software profissional de criacao, nao site de marketing generico. A linguagem correta aqui e:

- tecnica
- precisa
- desktop-first
- escura
- limpa
- sofisticada sem excesso
- orientada a produtividade

## Identidade Visual do 3Forge

### Essencia

- A UI deve transmitir ferramenta seria de criacao.
- O utilizador deve sentir controlo, precisao e foco.
- A interface precisa de parecer robusta o suficiente para fluxos longos de trabalho.
- O visual deve ficar entre software criativo e software tecnico, sem cair nem em gamer UI nem em SaaS generico.

### Linguagem Formal

- Base escura com profundidade discreta.
- Paineis em camadas com leves gradientes, nao chapados.
- Bordas suaves e de baixo contraste.
- Sombras presentes, mas contidas.
- Densidade media para alta, sem claustrofobia.
- Microcontrastes para separar estrutura sem poluicao.

## Direcao Visual Obrigatoria

Sempre que desenhares ou alterares UI no `3Forge`, seguir estas regras:

1. Preservar o carater de aplicacao desktop profissional.
2. Tratar a viewport como area principal e os paineis como infraestrutura de precisao.
3. Priorizar legibilidade, escaneabilidade e eficiencia de uso.
4. Usar o acento visual para orientar a acao, nao para colorir tudo.
5. Manter a interface contida, calibrada e tecnicamente confiavel.

## Cores do 3Forge

### Paleta Base

O `3Forge` ja aponta para esta familia visual:

- fundos quase pretos com variacao sutil entre camadas
- cinzas frios e ligeiramente azulados
- texto claro com niveis bem definidos
- acento violeta para selecao, CTA, foco e estado ativo

### Regras de Uso

- Manter os neutros como base dominante da composicao.
- Usar o violeta do produto como acento principal, porque ele ja faz parte da identidade atual.
- Nao introduzir novas cores de destaque sem motivo funcional forte.
- O acento deve aparecer em estados ativos, foco, selecao, drag targets, toggles ativos e highlights estrategicos.
- Estados de erro, aviso e sucesso devem ser claros, mas visualmente subordinados ao sistema base.

### O que evitar

- Grandes areas preenchidas com a cor de acento.
- Misturar acentos secundarios concorrentes.
- Contraste baixo em textos, labels e informacao de apoio.
- Paineis com o mesmo tom exato sem qualquer separacao de camada.

## Tipografia do 3Forge

### Papel tipografico

- UI operacional: limpa, neutra, compacta e altamente legivel.
- Titulos de produto ou momentos de marca: podem usar uma voz mais expressiva e condensada.

### Regras

- Em UI principal, seguir tipografia de sistema ou equivalente neutra e eficiente.
- Em elementos de branding, hero ou landing, usar tipografia condensada forte quando isso reforcar a identidade do produto.
- Labels tecnicas, tabs, meta info e badges devem ter ritmo compacto e consistencia de caixa.
- Evitar pesos em excesso e escalas tipograficas espalhadas.
- A hierarquia deve vir de contraste, peso e espacamento, nao de ruido visual.

### Assinatura visual observada

- `Barlow Condensed` encaixa bem em titulos de produto e momentos de apresentacao.
- Tipografia de sistema encaixa melhor na interface operacional.

## Layout

### Estrutura esperada

- Barra superior utilitaria e compacta.
- Toolbar secundaria funcional, com grupos claros.
- Workspace com viewport dominante.
- Coluna lateral de inspecao e estrutura.
- Status bar discreta, mas informativa.
- Dock inferior proprio para timeline e paineis temporais.

### Regras de composicao

- A viewport e o palco principal.
- Paineis devem enquadrar o trabalho, nao competir com ele.
- A grelha da app precisa de parecer estavel e bem ancorada.
- Espacamento deve ser consistente e ligeiramente compacto.
- O alinhamento deve parecer tecnico e deliberado.
- Footer e timeline nunca devem disputar o mesmo espaco estrutural.
- Paineis ocultos devem colapsar o dock inteiro correto, nao apenas sumir visualmente.
- O layout do editor nao deve depender da ordem acidental dos siblings React para parecer correto.

## Shell e Docking

### Regras obrigatorias

- `workspace`, `timeline dock` e `statusbar` devem ser regioes separadas do layout.
- Quando a timeline estiver escondida, o footer continua ancorado na shell principal.
- Splitters devem operar dentro de regioes estaveis, nunca como remendo para layout fragil.
- `min-height: 0` e contratos de `overflow` devem ser tratados como parte da arquitetura, nao como detalhe cosmetico.
- Se uma regiao do editor puder ser escondida, o comportamento esperado deve ser previsivel em resize e breakpoints.

## Componentes do 3Forge

### Paineis

- Devem ter profundidade leve com gradient sutil.
- Borda fina e de baixo contraste.
- Header compacto, claro e funcional.
- O corpo deve privilegiar leitura, organizacao e densidade controlada.

### Toolbars

- Devem comunicar ferramentas de forma rapida.
- Grupos devem ser evidentes por proximidade e padrao.
- Estados ativos precisam de ser imediatamente reconheciveis.
- Organizar por intencao: contexto, estado atual, ferramentas, modos de visualizacao e utilitarios.
- Nao misturar tudo no mesmo peso visual.
- Toggles com estado binario devem comunicar `on/off` claramente.

### Scene graph

- Deve parecer uma estrutura tecnica e navegavel.
- O estado selecionado precisa de ficar muito claro.
- Hover, drag e drop devem ser subtis, mas inequivocos.
- O nivel de detalhe visual deve ajudar orientacao hierarquica, nao enfeitar.
- Acoes importantes nao devem depender apenas de hover.
- Estados de ancestralidade, drop target e foco precisam de ser distinguiveis em poucos segundos.
- A hierarchy deve privilegiar leitura de arvore antes de microdecoracao.

### Inspector

- Deve transmitir confianca e precisao.
- Organizacao por secoes e grupos deve reduzir carga cognitiva.
- Controles precisam de parecer editaveis, estaveis e consistentes.
- A densidade pode ser alta, desde que o ritmo visual se mantenha limpo.
- Tabs de secoes nao devem depender apenas de icones quando isso prejudicar descoberta.
- Cada secao deve deixar claro o seu papel: objeto, transform, geometria, material, texto, imagem.

### Menus e modais

- Devem ser compactos, escuros e utilitarios.
- Nao devem parecer popups de marketing.
- A prioridade da acao precisa de ser imediata.

### Landing page

- Pode ser mais atmosferica do que a area operacional.
- Ainda assim, deve manter a mesma familia visual do editor.
- O branding pode ser mais expressivo, mas sem quebrar o DNA tecnico do produto.

## Motion

- Animacoes devem ser discretas, suaves e funcionais.
- Pequenas transicoes de hover, focus, fade e entrada sao bem-vindas.
- Evitar motion exibicionista.
- A sensacao deve ser de refinamento tecnico, nao de espetaculo.

## Estados de Interacao

- Todo controle interativo relevante deve ter `hover`, `focus-visible`, `active` e `disabled`.
- Em UI escura, `focus-visible` nao pode ficar implicito; ele precisa ser desenhado de forma consistente.
- Selecionado, ativo, foco e hover nao podem parecer o mesmo estado.
- Usar o violeta como estado ativo e de foco estrategico, nao como preenchimento estrutural da interface inteira.

## Densidade e Escala

- O `3Forge` aceita densidade media-alta, mas com ritmo consistente.
- Usar uma escala curta e repetivel para:
  - altura de headers
  - altura de controles
  - paddings de cards e paines
  - row heights de listas tecnicas
- Quando dois paineis semelhantes tiverem cromes diferentes, normalizar antes de introduzir novos componentes.

## Densidade e Ritmo

- O `3Forge` aceita densidade superior a interfaces casuais.
- Mesmo assim, toda densidade precisa de ser organizada.
- Usar espacamento para criar respiracao entre grupos, nao para deixar tudo solto.
- Quando houver muitas ferramentas, reduzir decoracao antes de reduzir clareza.

## Responsividade

- O produto e desktop-first.
- Ao adaptar para larguras menores, preservar o fluxo do editor antes de tentar transformar tudo em experiencia mobile completa.
- Se houver versao compacta, ela deve continuar a parecer ferramenta profissional.
- Nunca sacrificar legibilidade, hit area ou hierarquia por compressao excessiva.
- Em breakpoints menores, o objetivo e manter previsibilidade estrutural, nao imitar app mobile.
- O viewport continua a ser o centro, mesmo quando os paineis forem reordenados.

## Mobile e Tablet

### Regra de produto

- `desktop` continua a ser o modo principal de autoria completa.
- `tablet` pode manter capacidades de edicao, desde que a composicao continue clara e controlada.
- `phone` nao deve tentar replicar o editor inteiro; por defeito deve assumir papel de `viewer / launcher / playback`.

### Phone

- Em telefone, preferir:
  - launcher claro
  - abrir ficheiro
  - continuar sessao local
  - abrir recente
  - viewport dominante
  - playback de animacao
- Em telefone, evitar:
  - scene graph completa
  - inspector denso
  - export panel
  - timeline de autoria completa
  - toolbar de edicao pesada
  - menus desktop encolhidos artificialmente
- O chrome de telefone deve ser curto, direto e orientado a consumo do projeto.
- O viewport deve ocupar a maior parte da altura util.
- Status e metadados devem ser resumidos; nao empilhar chips ou badges sem necessidade.

### Tablet

- Tablet pode continuar editavel, mas com composicao compacta e intencional.
- Em tablet, reorganizar o editor por prioridade:
  - viewport primeiro
  - painel lateral/tabulado depois
  - timeline em modo mais compacto quando necessario
- A toolbar em tablet deve ser reagrupada por intencao, nao apenas quebrada em varias linhas.
- Se faltar espaco, reduzir redundancia e cromes antes de esconder capacidades essenciais.

### Landing / Welcome em mobile

- A welcome screen e parte do produto, nao splash descartavel.
- Em mobile, a landing deve funcionar como launcher real.
- A landing precisa:
  - mostrar logo sem corte
  - permitir scroll vertical quando o conteudo exceder a altura
  - priorizar as acoes principais antes de blocos decorativos
  - evitar hero page longa ou demasiado promocional
- Em `phone`, remover densidade desnecessaria antes de reduzir tipografia ou hit area.
- Nao usar `overflow: hidden` na shell da landing se isso puder cortar conteudo ou impedir scroll.

### Shell responsiva

- Diferenciar explicitamente `phone`, `tablet` e `desktop` quando o produto mudar de natureza.
- Nao depender apenas de um unico booleano `compact`.
- Se `phone` usar viewer mode, a shell deve mudar de estrutura e nao apenas esconder meia duzia de paineis.
- Footer, viewport e docks precisam continuar em regioes previsiveis em todos os modos.

### Playback mobile

- Em telefone, animacao deve ser controlada por UI curta:
  - play/pause
  - stop
  - clip selector
  - scrubber simples
- A UI de playback deve parecer robusta, nao um prototipo improvisado.
- Se nao houver clips, mostrar estado vazio curto e explicito.

### Regras de decisao para menor largura

- Em telas pequenas, cortar complexidade antes de cortar clareza.
- Remover chrome desnecessario antes de encolher controles uteis.
- Manter a ordem:
  - acao principal
  - contexto
  - navegacao secundaria
  - detalhe tecnico
- Se um bloco nao ajudar `abrir`, `continuar`, `ver` ou `controlar`, ele provavelmente nao pertence ao phone.

## Empty States

- Empty states devem orientar a proxima acao, nao apenas descrever ausencia.
- Preferir:
  - titulo curto
  - explicacao objetiva
  - proximo passo implicito ou explicito
- Empty states em paineis operacionais devem parecer parte da ferramenta, nao mensagem genérica.

## Principios de Decisao

Quando houver mais de uma solucao de UI valida, escolher a que:

- parece mais `3Forge`
- parece mais precisa e profissional
- melhora mais o fluxo de trabalho
- reduz mais ruido sem perder capacidade
- usa melhor a profundidade escura e o acento violeta
- preserva o equilibrio entre criatividade e engenharia
- mantem contratos estruturais estaveis com paineis visiveis ou ocultos
- torna estados e affordances compreensiveis sem depender de hover ou adivinhacao

## O que o Design do 3Forge Nao Deve Virar

- um dashboard SaaS branco com cards genericos
- uma interface neon futurista caricata
- uma UI gamer carregada
- uma mistura de estilos sem sistema
- um layout fofo ou casual demais
- um produto visualmente plano e sem hierarquia

## Processo de Trabalho

Sempre que trabalhares em UI no `3Forge`:

1. Identificar se a area e operacional, estrutural ou de marca.
2. Confirmar o papel da tela no fluxo do editor.
3. Preservar a linguagem dark, tecnica e precisa do produto.
4. Reutilizar a familia de neutros, gradientes e acento violeta do sistema atual.
5. Confirmar se a mudanca afeta shell, docking, overflow ou resize.
6. Ajustar hierarquia, densidade e legibilidade antes de adicionar novos efeitos.
7. Refinar estados ativos, hover, foco, erro, vazio e loading com consistencia sistemica.
8. Validar se o resultado ainda parece claramente `3Forge`.

## Checklist de Revisao

Antes de finalizar qualquer mudanca visual, confirmar:

- A interface parece ferramenta profissional de criacao 3D?
- A viewport continua a ser o centro da experiencia quando aplicavel?
- Os paineis ajudam o trabalho em vez de pesar visualmente?
- O violeta foi usado como acento e nao como tinta geral?
- A densidade esta organizada e legivel?
- A hierarquia esta clara em poucos segundos?
- A UI parece consistente com menu bar, toolbar, inspector e scene graph existentes?
- Footer, timeline e workspace continuam estruturalmente separados?
- Esconder paines ainda produz um layout estavel?
- Os controlos principais continuam compreensiveis sem hover?
- Existe `focus-visible` consistente nos elementos interativos relevantes?
- O empty state ajuda o proximo passo em vez de apenas informar ausencia?
- O resultado parece extensao natural do `3Forge`, e nao redesign de outro produto?

## Resultado Esperado

As interfaces do `3Forge` devem transmitir:

- precisao
- controlo
- foco
- confianca
- sofisticacao tecnica
- profundidade escura bem composta
- identidade visual coerente com ferramenta criativa profissional

Se houver duvida entre uma solucao mais chamativa e uma mais calibrada ao produto, escolher a mais calibrada ao `3Forge`.
