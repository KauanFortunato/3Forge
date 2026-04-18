# Fluxo de Entrada, Persistência Local e Recentes

## Objetivo

Reestruturar o arranque do 3Forge para separar:

- sessão atual da aba
- projeto persistido localmente no navegador
- ficheiro externo do utilizador
- lista de recentes
- permissões relevantes de sistema

## Decisões principais

- `reload` não é tratado como nova entrada no app.
- reentrada normal mostra sempre a welcome screen.
- o projeto atual continua salvo localmente no navegador até ser substituído ou apagado explicitamente.
- `Exit` sai do projeto atual, mas não apaga a persistência local.
- abrir ficheiro externo cria item em `Recentes`.
- recentes guardam snapshot local e, quando possível, `FileSystemFileHandle` persistido.
- `Save` tenta sobrescrever o ficheiro atual quando existe handle válido.
- sem handle ou sem permissão útil, o fluxo cai para `Save As`.
- quando a File System Access API não existe, o fallback é download do blueprint JSON.

## Persistência

- `localStorage`
  - snapshot atual do projeto
  - contexto do workspace
  - lista de recentes
  - snapshots dos recentes
- `sessionStorage`
  - marca de sessão ativa para distinguir `reload` de reentrada
- `IndexedDB`
  - persistência dos `FileSystemFileHandle` para reabrir recentes e manter overwrite quando suportado

## Clipboard

- o clipboard interno do editor continua separado do clipboard nativo do browser
- a permissão de clipboard tratada nesta feature afeta apenas cópia de export para texto

## UX

- welcome screen agora oferece:
  - Continue where you left off
  - Open file
  - New project
  - Open recent
- o menu `File` passou a concentrar:
  - New Project
  - Open File
  - Open Recent
  - Save
  - Save As
  - imports existentes
  - exports existentes
  - Exit
