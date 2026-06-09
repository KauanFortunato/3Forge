# Plano: resolução de máscara dirigida por atributos (sair do nome) — guia mentor

> **Formato:** este plano é pra VOCÊ implementar, passo a passo, aprendendo. Cada
> passo tem: **conceito** (por quê), **onde** (arquivo:linha), **o quê** (código),
> e **verificar** (comando). Faça um passo de cada vez e me mostre o resultado /
> pergunte. Não pule a verificação — é a rede de segurança.

**Goal:** identificar as máscaras de foto (`PHOTO_MASK`/`PHOTO_DUMMY`) por
**atributos + GUID + ordem de descoberta**, em vez de regex no nome — sem mudar o
comportamento do stencil (LEFT/RIGHT continuam idênticos).

**Arquitetura:** o mecanismo de stencil (writer/reader, campos de bits) **fica como
está**. Só troca a *fonte da informação*: a classe da máscara vem de
`MaskProperties` e o "slot" vem da ordem de descoberta no documento, não do número
no nome. O caminho genérico (`BASE_*`) já faz isso — vamos alinhar o caminho PHOTO.

**Por que é seguro:** as únicas quads com `IsMask="True"` no corpus são `BASE_*`
(coloridas) e `PHOTO_MASK/DUMMY` (não-coloridas). Filtrar por
`isMask && isColoredMask !== true` pega exatamente o mesmo conjunto que a regex
pegava, e a ordem de descoberta no LINEUP dá slots 1..5 = os mesmos índices do nome.
→ resultado byte-idêntico, 449 testes seguem verdes.

---

## Pré-requisito: baseline VERDE

O TDD exige começar com tudo verde. Hoje o working tree **não compila** por causa da
mudança incompleta de `rotationOrder` em `data.ts`. Antes de tudo, resolva isso:

- [ ] **P0.** Ou terminamos o `rotationOrder` (te oriento à parte), ou guarde-o
  temporariamente:
  ```bash
  git stash push -- playgrounds/w3d-translation/src/nodes/data.ts
  ```
- [ ] **P0.verify.** Baseline verde:
  ```bash
  npx tsc --noEmit
  npx vitest run playgrounds/w3d-translation 2>&1 | tail -4
  ```
  Esperado: `tsc` sem saída + `449 passed`.

---

## Task 1 — Teste que prova a independência de nome (TDD: vermelho primeiro)

**Conceito:** antes de mudar o código, escreva um teste que FALHA hoje e vai PASSAR
depois. Ele monta uma cena com uma máscara cujo nome **não** casa com `PHOTO_MASK`
(ex.: `"FOO_SHAPE"`), referenciada por um reader, e exige que o reader receba
configuração de stencil. Com o código atual (regex de nome), `FOO_SHAPE` é ignorada
→ o reader não recebe stencil → teste falha. É exatamente o que queremos consertar.

**Files:**
- Modify (test): `playgrounds/w3d-translation/src/nodes/builder.test.ts` (adicione no fim do `describe` principal, perto dos outros testes de stencil)

- [ ] **Step 1.1 — Escreva o teste.** Adicione:

```ts
test("mask is recognised by ATTRIBUTES, not name (non-PHOTO_ name still wires stencil)", () => {
  // A shape mask (IsMask, not colored, DisableBinaryAlpha=false) named arbitrarily,
  // plus a reader that references it by GUID. The reader must get stencil clipping.
  const mask = quadData({
    id: "m1",
    name: "FOO_SHAPE",          // deliberately NOT matching PHOTO_MASK_\d+
    isMask: true,
    maskProperties: { isColoredMask: false, disableBinaryAlpha: false, isInvertedMask: false },
  });
  const reader = quadData({ id: "r1", name: "ANYTHING", maskIds: ["m1"] });
  const root = groupData({ id: "g", name: "G", children: [mask, reader] });

  const ctx: BuildContext = { warnings: [] };
  const built = buildNodeTree([root], ctx);
  let readerMesh: Mesh | undefined;
  built.traverse((o) => {
    if ((o.userData?.w3d as { id?: string } | undefined)?.id === "r1") readerMesh = o as Mesh;
  });
  expect(readerMesh, "reader mesh built").toBeDefined();
  const mat = readerMesh!.material as MeshBasicMaterial;
  expect(mat.stencilWrite, "reader should be stencil-clipped by FOO_SHAPE").toBe(true);
  expect(mat.stencilFunc).toBe(NotEqualStencilFunc); // not inverted → visible outside the shape
});
```

> Conferir os imports no topo de `builder.test.ts`: precisa de `Mesh`,
> `MeshBasicMaterial`, `NotEqualStencilFunc` (de `three`) e `BuildContext`. Os dois
> primeiros já são importados; adicione `NotEqualStencilFunc` à lista de `three` se
> faltar. Os helpers `quadData`/`groupData` já existem no arquivo.

- [ ] **Step 1.2 — Rode e veja FALHAR (vermelho).**
  ```bash
  npx vitest run playgrounds/w3d-translation/src/nodes/builder.test.ts -t "recognised by ATTRIBUTES" 2>&1 | tail -15
  ```
  Esperado: FALHA — `expected false to be true` (o reader não recebeu stencil porque
  `FOO_SHAPE` não casou com a regex). **Esse vermelho é o objetivo.**

---

## Task 2 — Refatorar `collectPhotoMaskInfo` (atributos + ordem)

**Conceito:** trocar "extrai índice do nome via regex" por "classe vem de
`disableBinaryAlpha`, slot vem da ordem de descoberta por classe". A classe `dummy`
(silhueta texturizada) tem `DisableBinaryAlpha=True`; a `mask` (forma geométrica) tem
`False`. O slot 1..7 é só um contador por classe — cada writer ganha um ref único no
seu campo de bits; o reader compõe o ref a partir dos GUIDs que referencia (isso já
funciona e não muda).

**Files:**
- Modify: `playgrounds/w3d-translation/src/nodes/builder.ts` — função `collectPhotoMaskInfo` (≈ linha 171–198)

- [ ] **Step 2.1 — Substitua o corpo da função.** Troque a função inteira por:

```ts
function collectPhotoMaskInfo(
  roots: W3DNodeData[],
  warnings?: string[],
): Map<string, PhotoMaskInfo> {
  const out = new Map<string, PhotoMaskInfo>();
  // Slot = discovery order WITHIN each class. Replaces the player index that used
  // to be parsed from the name. The reader composes its stencil ref from the GUIDs
  // it references, so each writer only needs a unique slot inside its own field.
  let maskSlots = 0;
  let dummySlots = 0;
  const walk = (n: W3DNodeData): void => {
    // Photo masks are the NON-coloured stencil writers (IsColoredMask=True is the
    // generic colored-mask path, handled by collectGenericMaskInfo).
    if (n.kind === "Quad" && n.isMask && n.maskProperties?.isColoredMask !== true) {
      // Class from DisableBinaryAlpha: textured silhouette (true) = "dummy",
      // geometric shape (false) = "mask". No name involved.
      const klass: PhotoMaskClass = n.maskProperties?.disableBinaryAlpha ? "dummy" : "mask";
      const isInverted = !!n.maskProperties?.isInvertedMask;
      const slot = klass === "dummy" ? ++dummySlots : ++maskSlots;
      if (slot > STENCIL_PLAYER_INDEX_MAX) {
        warnings?.push(`Photo mask "${n.name}" (${klass}) exceeds the ${STENCIL_PLAYER_INDEX_MAX}-slot stencil field; skipping.`);
      } else {
        out.set(n.id, { klass, playerIndex: slot, isInverted, name: n.name });
      }
    }
    for (const c of n.children) walk(c);
  };
  for (const r of roots) walk(r);
  return out;
}
```

- [ ] **Step 2.2 — Rode o teste novo (deve PASSAR agora — verde).**
  ```bash
  npx vitest run playgrounds/w3d-translation/src/nodes/builder.test.ts -t "recognised by ATTRIBUTES" 2>&1 | tail -6
  ```
  Esperado: `1 passed`.

- [ ] **Step 2.3 — Rode TUDO do builder (garantir que LEFT/stencil não regrediu).**
  ```bash
  npx vitest run playgrounds/w3d-translation/src/nodes/builder.test.ts 2>&1 | grep -v getContext | tail -5
  ```
  Esperado: tudo verde. Se algo quebrar, **pare e me mostre** — provavelmente é um
  caso de máscara que eu não previ; a gente investiga junto.

---

## Task 3 — Limpar o caminho genérico + regex órfãs

**Conceito:** agora a regex `PHOTO_MASK/DUMMY` não é mais usada pra identidade. O
`collectGenericMaskInfo` ainda a usa pra EXCLUIR máscaras de foto — mas isso é
redundante, porque máscaras de foto têm `isColoredMask=false` e o filtro genérico já
exige `isColoredMask===true`. Remova as duas linhas de regex; depois remova as consts
órfãs pra não sobrar código morto.

**Files:**
- Modify: `playgrounds/w3d-translation/src/nodes/builder.ts` — `collectGenericMaskInfo` (≈ linha 215–221) e as consts `PHOTO_MASK_NAME_RE`/`PHOTO_DUMMY_NAME_RE` (≈ linha 168–169)

- [ ] **Step 3.1 — No `collectGenericMaskInfo`, apague as duas linhas de exclusão:**

```ts
      // REMOVER estas duas linhas:
      !PHOTO_MASK_NAME_RE.test(n.name) &&
      !PHOTO_DUMMY_NAME_RE.test(n.name)
```
Fica:
```ts
    if (
      n.kind === "Quad" &&
      n.isMask &&
      n.maskProperties?.isColoredMask === true
    ) {
      candidates.push(n);
    }
```

- [ ] **Step 3.2 — Remova as consts órfãs** (linha ~168–169):
```ts
// REMOVER (não são mais usadas por ninguém):
const PHOTO_MASK_NAME_RE = /^PHOTO_MASK_(\d+)$/;
const PHOTO_DUMMY_NAME_RE = /^PHOTO_DUMMY_(\d+)$/;
```
> ⚠️ Antes de remover, confirme que não há mais usos:
> ```bash
> grep -rn "PHOTO_MASK_NAME_RE\|PHOTO_DUMMY_NAME_RE" playgrounds/w3d-translation/src
> ```
> Se aparecer só a própria declaração (ou nada), pode remover. Se aparecer em outro
> lugar (ex.: `augmentPhotoFillMaskIds`), **não remova ainda** — me avise.
> (`PHOTO_FILL_NAME_RE` é OUTRA const e CONTINUA usada — não mexa nela.)

- [ ] **Step 3.3 — Typecheck (pega const órfã / import não usado).**
  ```bash
  npx tsc --noEmit
  ```
  Esperado: sem saída.

---

## Task 4 — Verificação completa (LEFT/RIGHT + tudo)

- [ ] **Step 4.1 — Suíte inteira.**
  ```bash
  npx vitest run playgrounds/w3d-translation 2>&1 | grep -v getContext | tail -5
  ```
  Esperado: `449 passed` (+1 do teste novo = 450).

- [ ] **Step 4.2 — Sanidade LEFT/RIGHT (opcional, visual).** Rode o app e confira
  que os players seguem certos:
  ```bash
  npm run dev:w3d-translation
  ```
  Abra LINEUP_LEFT e LINEUP_RIGHT; nada deve ter mudado de posição/recorte.

---

## Task 5 — Commit

- [ ] **Step 5.1 — Commit (numa branch, não na main).**
  ```bash
  git add playgrounds/w3d-translation/src/nodes/builder.ts playgrounds/w3d-translation/src/nodes/builder.test.ts
  git commit -m "refactor(w3d): identify photo masks by attributes+order, not name regex"
  ```

---

## O que NÃO está neste plano (fases futuras)
- `augmentPhotoFillMaskIds` (regex `PHOTO_FILL_\d+`) — o fallback que pareia FILL→MASK.
- `photoCardRenderOrder` / `isPhotoCardClient` (regex de nome p/ ordem de camada).
- RTT (máscara por textura) — mata o limite de 8 bits e dá borda soft.

Cada uma vira um plano próprio quando você quiser.
