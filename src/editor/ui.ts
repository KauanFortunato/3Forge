import { fontFileToAsset } from "./fonts";
import { imageFileToAsset } from "./images";
import { exportBlueprintToJson, generateTypeScriptComponent } from "./exports";
import {
  EDITOR_AUTOSAVE_KEY,
  EditorStore,
  ROOT_NODE_ID,
  getDisplayValue,
  getPropertyDefinitions,
} from "./state";
import { SceneEditor } from "./scene";
import type { EditableFieldEntry, EditorNode, EditorStoreChange, ImageNode, NodePropertyDefinition, TextNode } from "./types";

type ExportMode = "json" | "typescript";
type LeftDockTab = "scene" | "insert";
type RightDockTab = "inspector" | "fields" | "export";
type DockGroup = "left" | "right";

interface EditorRefs {
  componentName: HTMLInputElement;
  sceneTree: HTMLDivElement;
  inspector: HTMLDivElement;
  editableFields: HTMLDivElement;
  viewport: HTMLDivElement;
  exportPreview: HTMLTextAreaElement;
  exportModeButtons: NodeListOf<HTMLButtonElement>;
  transformButtons: NodeListOf<HTMLButtonElement>;
  dockTabButtons: NodeListOf<HTMLButtonElement>;
  dockPanels: NodeListOf<HTMLElement>;
  status: HTMLDivElement;
  importInput: HTMLInputElement;
  selectionMeta: HTMLDivElement;
  nodeCountMeta: HTMLDivElement;
  sceneSummary: HTMLParagraphElement;
  fieldsSummary: HTMLParagraphElement;
  undoButton: HTMLButtonElement;
  redoButton: HTMLButtonElement;
  fontImportInput: HTMLInputElement;
  imageImportInput: HTMLInputElement;
}

interface FocusSnapshot {
  key: string;
  selectionStart: number | null;
  selectionEnd: number | null;
}

interface NodeClipboard {
  sourceNodeId: string;
  nodes: EditorNode[];
}

type PendingImageImport =
  | { mode: "create" }
  | { mode: "replace"; nodeId: string };

type SceneTreeChildrenMap = Map<string | null, EditorNode[]>;

export class ComponentEditorApp {
  private readonly root: HTMLElement;
  private readonly store: EditorStore;
  private readonly scene: SceneEditor;
  private readonly refs: EditorRefs;
  private readonly unsubscribe: () => void;

  private exportMode: ExportMode = "json";
  private statusTimeout = 0;
  private nodeClipboard: NodeClipboard | null = null;
  private pendingImageImport: PendingImageImport | null = null;
  private sceneTreeDragNodeId: string | null = null;
  private sceneTreeDropTargetId: string | null = null;
  private activeDockTabs: { left: LeftDockTab; right: RightDockTab } = {
    left: "scene",
    right: "inspector",
  };

  constructor(root: HTMLElement) {
    this.root = root;
    this.root.innerHTML = createLayout();

    this.store = new EditorStore();
    this.refs = {
      componentName: this.root.querySelector<HTMLInputElement>("#component-name")!,
      sceneTree: this.root.querySelector<HTMLDivElement>("#scene-tree")!,
      inspector: this.root.querySelector<HTMLDivElement>("#inspector")!,
      editableFields: this.root.querySelector<HTMLDivElement>("#editable-fields")!,
      viewport: this.root.querySelector<HTMLDivElement>("#viewport")!,
      exportPreview: this.root.querySelector<HTMLTextAreaElement>("#export-preview")!,
      exportModeButtons: this.root.querySelectorAll<HTMLButtonElement>("[data-export-mode]"),
      transformButtons: this.root.querySelectorAll<HTMLButtonElement>("[data-transform-mode]"),
      dockTabButtons: this.root.querySelectorAll<HTMLButtonElement>("[data-dock-group][data-dock-tab]"),
      dockPanels: this.root.querySelectorAll<HTMLElement>("[data-dock-panel]"),
      status: this.root.querySelector<HTMLDivElement>("#editor-status")!,
      importInput: this.root.querySelector<HTMLInputElement>("#import-blueprint-input")!,
      selectionMeta: this.root.querySelector<HTMLDivElement>("#selection-meta")!,
      nodeCountMeta: this.root.querySelector<HTMLDivElement>("#node-count-meta")!,
      sceneSummary: this.root.querySelector<HTMLParagraphElement>("#scene-summary")!,
      fieldsSummary: this.root.querySelector<HTMLParagraphElement>("#fields-summary")!,
      undoButton: this.root.querySelector<HTMLButtonElement>("#undo-action")!,
      redoButton: this.root.querySelector<HTMLButtonElement>("#redo-action")!,
      fontImportInput: this.root.querySelector<HTMLInputElement>("#import-font-input")!,
      imageImportInput: this.root.querySelector<HTMLInputElement>("#import-image-input")!,
    };

    this.scene = new SceneEditor(this.refs.viewport, this.store);
    this.refs.viewport.tabIndex = 0;
    this.bindEvents();
    this.restoreAutosave();
    this.syncDockTabs();

    this.unsubscribe = this.store.subscribe((change) => {
      this.persist(change);
      this.render(change);
    });

    this.render();
  }

  destroy(): void {
    window.clearTimeout(this.statusTimeout);
    this.unsubscribe();
    this.scene.dispose();
  }

  private bindEvents(): void {
    this.refs.viewport.addEventListener("pointerdown", () => {
      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLInputElement ||
        activeElement instanceof HTMLTextAreaElement ||
        activeElement instanceof HTMLSelectElement
      ) {
        activeElement.blur();
      }

      this.refs.viewport.focus({ preventScroll: true });
    });

    this.refs.componentName.addEventListener("input", () => {
      this.store.updateComponentName(this.refs.componentName.value);
    });

    this.root.querySelectorAll<HTMLButtonElement>("[data-create-node]").forEach((button) => {
      button.addEventListener("click", () => {
        const type = button.dataset.createNode;
        if (!type) return;
        if (type === "image") {
          this.openImageImportDialog({ mode: "create" });
          return;
        }
        this.store.addNode(type as EditorNode["type"]);
        this.scene.setTransformMode("translate");
        this.scene.frameSelection();
        this.activeDockTabs.right = "inspector";
        this.syncDockTabs();
        this.syncTransformButtons();
        this.setStatus(type === "text" ? "Novo texto 3D criado." : `Novo ${type} criado.`);
      });
    });

    this.refs.undoButton.addEventListener("click", () => {
      this.handleUndo();
    });

    this.refs.redoButton.addEventListener("click", () => {
      this.handleRedo();
    });

    this.refs.dockTabButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const group = button.dataset.dockGroup;
        const tab = button.dataset.dockTab;
        if (!group || !tab) return;
        this.setDockTab(group as DockGroup, tab);
      });
    });

    this.root.querySelector<HTMLButtonElement>("#delete-node")?.addEventListener("click", () => {
      if (this.store.selectedNodeId === ROOT_NODE_ID) {
        this.setStatus("O root nao pode ser removido.");
        return;
      }

      this.store.deleteSelected();
    });

    this.root.querySelector<HTMLButtonElement>("#new-blueprint")?.addEventListener("click", () => {
      const shouldReset = window.confirm("Criar um novo blueprint? A cena atual sera substituida.");
      if (!shouldReset) {
        return;
      }

      this.store.loadBlueprint(undefined, "system");
      this.setStatus("Blueprint reiniciado.");
    });

    this.root.querySelector<HTMLButtonElement>("#restore-autosave")?.addEventListener("click", () => {
      this.restoreAutosave(true);
    });

    this.root.querySelector<HTMLButtonElement>("#import-blueprint")?.addEventListener("click", () => {
      this.refs.importInput.click();
    });

    this.root.querySelector<HTMLButtonElement>("#import-font")?.addEventListener("click", () => {
      this.refs.fontImportInput.click();
    });

    this.root.querySelector<HTMLButtonElement>("#import-image")?.addEventListener("click", () => {
      this.openImageImportDialog({ mode: "create" });
    });

    this.refs.importInput.addEventListener("change", async () => {
      const file = this.refs.importInput.files?.[0];
      if (!file) {
        return;
      }

      try {
        const text = await file.text();
        this.store.loadBlueprint(JSON.parse(text));
        this.setStatus(`Blueprint importado: ${file.name}`);
      } catch (error) {
        console.error(error);
        this.setStatus("Falha ao importar o blueprint.");
      } finally {
        this.refs.importInput.value = "";
      }
    });

    this.refs.fontImportInput.addEventListener("change", async () => {
      const file = this.refs.fontImportInput.files?.[0];
      if (!file) {
        return;
      }

      try {
        const font = await fontFileToAsset(file);
        const fontId = this.store.addFont(font);

        if (this.store.selectedNode?.type === "text") {
          this.store.updateTextNodeFont(this.store.selectedNode.id, fontId);
        }

        this.activeDockTabs.right = "inspector";
        this.syncDockTabs();
        this.setStatus(`Fonte pronta: ${font.name}`);
      } catch (error) {
        console.error(error);
        this.setStatus("Nao foi possivel importar a fonte.");
      } finally {
        this.refs.fontImportInput.value = "";
      }
    });

    this.refs.imageImportInput.addEventListener("change", async () => {
      const file = this.refs.imageImportInput.files?.[0];
      const pendingImport = this.pendingImageImport;
      this.pendingImageImport = null;

      if (!file) {
        return;
      }

      try {
        const image = await imageFileToAsset(file);

        if (pendingImport?.mode === "replace") {
          this.store.updateImageNodeAsset(pendingImport.nodeId, image);
          this.setStatus(`Imagem atualizada: ${image.name}`);
        } else {
          this.store.addImageNode(image);
          this.scene.setTransformMode("translate");
          this.scene.frameSelection();
          this.activeDockTabs.right = "inspector";
          this.syncDockTabs();
          this.syncTransformButtons();
          this.setStatus(`Imagem adicionada: ${image.name}`);
        }
      } catch (error) {
        console.error(error);
        this.setStatus("Nao foi possivel importar a imagem.");
      } finally {
        this.refs.imageImportInput.value = "";
      }
    });

    this.refs.exportModeButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.exportMode;
        if (mode === "json" || mode === "typescript") {
          this.exportMode = mode;
          this.renderExports();
          this.syncExportModeButtons();
        }
      });
    });

    this.root.querySelector<HTMLButtonElement>("#copy-export")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(this.refs.exportPreview.value);
        this.setStatus("Export copiado para a area de transferencia.");
      } catch (error) {
        console.error(error);
        this.setStatus("Nao foi possivel copiar o export.");
      }
    });

    this.root.querySelector<HTMLButtonElement>("#download-export")?.addEventListener("click", () => {
      const extension = this.exportMode === "json" ? "json" : "ts";
      const fileName = `${this.store.blueprint.componentName || "component"}.${extension}`;
      downloadText(fileName, this.refs.exportPreview.value);
      this.setStatus(`Arquivo exportado: ${fileName}`);
    });

    this.refs.transformButtons.forEach((button) => {
      button.addEventListener("click", () => {
        const mode = button.dataset.transformMode;
        if (mode === "select" || mode === "translate" || mode === "rotate" || mode === "scale") {
          this.scene.setTransformMode(mode);
          this.syncTransformButtons();
        }
      });
    });

    this.root.querySelector<HTMLButtonElement>("#frame-selection")?.addEventListener("click", () => {
      this.scene.frameSelection();
    });

    window.addEventListener("keydown", (event) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement;

      if (isTyping) {
        return;
      }

      if (event.key === "Delete") {
        this.store.deleteSelected();
        return;
      }

      const isUndo = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "z";
      const isRedo = (event.ctrlKey && event.key.toLowerCase() === "y") || (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "z");
      const isCopy = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "c";
      const isPaste = event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === "v";

      if (isUndo) {
        event.preventDefault();
        this.handleUndo();
        return;
      }

      if (isRedo) {
        event.preventDefault();
        this.handleRedo();
        return;
      }

      if (isCopy) {
        event.preventDefault();
        this.handleCopy();
        return;
      }

      if (isPaste) {
        event.preventDefault();
        this.handlePaste();
        return;
      }

      const keyCode = event.code;

      if (keyCode === "Digit1" || keyCode === "Numpad1") {
        this.scene.setTransformMode("select");
        this.syncTransformButtons();
        event.preventDefault();
        return;
      }

      if (keyCode === "Digit2" || keyCode === "Numpad2") {
        this.scene.setTransformMode("translate");
        this.syncTransformButtons();
        event.preventDefault();
        return;
      }

      if (keyCode === "Digit3" || keyCode === "Numpad3") {
        this.scene.setTransformMode("rotate");
        this.syncTransformButtons();
        event.preventDefault();
        return;
      }

      if (keyCode === "Digit4" || keyCode === "Numpad4") {
        this.scene.setTransformMode("scale");
        this.syncTransformButtons();
        event.preventDefault();
        return;
      }

      if (event.key.toLowerCase() === "f") {
        this.scene.frameSelection();
        event.preventDefault();
      }
    });
  }

  private restoreAutosave(force = false): void {
    const saved = localStorage.getItem(EDITOR_AUTOSAVE_KEY);
    if (!saved) {
      if (force) {
        this.setStatus("Nenhum autosave encontrado.");
      }
      return;
    }

    try {
      this.store.loadBlueprint(JSON.parse(saved), "system");
      this.setStatus("Autosave restaurado.");
    } catch (error) {
      console.error(error);
      if (force) {
        this.setStatus("Autosave invalido.");
      }
    }
  }

  private persist(change: EditorStoreChange): void {
    if (change.reason === "selection") {
      return;
    }

    localStorage.setItem(EDITOR_AUTOSAVE_KEY, exportBlueprintToJson(this.store.blueprint));
  }

  private render(change?: EditorStoreChange): void {
    const focusSnapshot = this.captureFocusSnapshot();

    if (document.activeElement !== this.refs.componentName) {
      this.refs.componentName.value = this.store.blueprint.componentName;
    }

    this.renderViewportMeta();
    this.renderSceneTree();
    this.renderInspector();
    this.renderEditableFields();
    this.renderExports();
    this.syncDockTabs();
    this.syncExportModeButtons();
    this.syncTransformButtons();
    this.syncHistoryButtons();
    this.restoreFocusSnapshot(focusSnapshot);

    const selectedNode = this.store.selectedNode;
    if (change?.reason === "selection" && selectedNode) {
      this.setStatus(`Selecionado: ${selectedNode.name}`);
    }
  }

  private renderViewportMeta(): void {
    const selectedNode = this.store.selectedNode;
    const nodeCount = this.store.blueprint.nodes.length;

    this.refs.selectionMeta.textContent = selectedNode
      ? `${selectedNode.name} | ${getSceneNodeKindLabel(selectedNode)}`
      : "Nenhum no selecionado";
    this.refs.nodeCountMeta.textContent = `${nodeCount} nodes`;
    this.refs.sceneSummary.textContent = `${nodeCount} nodes na cena`;
  }

  private renderSceneTree(): void {
    this.refs.sceneTree.innerHTML = "";
    const childrenByParent = new Map<string | null, EditorNode[]>();

    for (const node of this.store.blueprint.nodes) {
      const bucket = childrenByParent.get(node.parentId) ?? [];
      bucket.push(node);
      childrenByParent.set(node.parentId, bucket);
    }

    for (const rootNode of childrenByParent.get(null) ?? []) {
      this.refs.sceneTree.appendChild(this.createSceneTreeBranch(rootNode, childrenByParent, 0));
    }
  }

  private renderInspector(): void {
    const node = this.store.selectedNode;
    this.refs.inspector.innerHTML = "";

    if (!node) {
      this.refs.inspector.innerHTML = `<p class="panel-empty">Selecione um objeto para editar.</p>`;
      return;
    }

    const fragment = document.createDocumentFragment();
    fragment.appendChild(this.createTextField("Node Name", node.name, (value) => this.store.updateNodeName(node.id, value), `inspector:${node.id}:name`));

    const parentWrapper = document.createElement("label");
    parentWrapper.className = "field-block";
    parentWrapper.innerHTML = `<span class="field-block__label">Parent</span>`;

    const parentSelect = document.createElement("select");
    parentSelect.className = "editor-select";
    parentSelect.dataset.focusKey = `inspector:${node.id}:parent`;
    if (node.id === ROOT_NODE_ID) {
      parentSelect.disabled = true;
    }

    for (const group of this.store.getEligibleParents(node.id)) {
      const option = document.createElement("option");
      option.value = group.id;
      option.textContent = group.name;
      option.selected = (node.parentId ?? ROOT_NODE_ID) === group.id;
      parentSelect.appendChild(option);
    }

    parentSelect.addEventListener("change", () => {
      this.store.reparentNode(node.id, parentSelect.value);
    });

    parentWrapper.appendChild(parentSelect);
    fragment.appendChild(parentWrapper);

    if (node.type === "text") {
      fragment.appendChild(this.createFontSection(node));
    }

    if (node.type === "image") {
      fragment.appendChild(this.createImageSection(node));
    }

    const groupedDefinitions = groupDefinitions(getPropertyDefinitions(node));
    for (const [groupName, definitions] of groupedDefinitions.entries()) {
      const section = document.createElement("section");
      section.className = "field-section";
      section.innerHTML = `<h4>${groupName}</h4>`;

      for (const definition of definitions) {
        section.appendChild(this.createPropertyField(node, definition));
      }

      fragment.appendChild(section);
    }

    this.refs.inspector.appendChild(fragment);
  }

  private renderEditableFields(): void {
    this.refs.editableFields.innerHTML = "";
    const entries = this.store.listEditableFields();
    this.refs.fieldsSummary.textContent = entries.length === 1
      ? "1 campo em runtime"
      : `${entries.length} campos em runtime`;

    if (entries.length === 0) {
      this.refs.editableFields.innerHTML = `<p class="panel-empty">Marque propriedades como editaveis para gerar opcoes de runtime.</p>`;
      return;
    }

    for (const entry of entries) {
      this.refs.editableFields.appendChild(this.createEditableFieldCard(entry));
    }
  }

  private renderExports(): void {
    const content = this.exportMode === "json"
      ? exportBlueprintToJson(this.store.blueprint)
      : generateTypeScriptComponent(this.store.blueprint);

    this.refs.exportPreview.value = content;
  }

  private syncDockTabs(): void {
    this.refs.dockTabButtons.forEach((button) => {
      const group = button.dataset.dockGroup;
      const tab = button.dataset.dockTab;

      const isActive =
        (group === "left" && tab === this.activeDockTabs.left) ||
        (group === "right" && tab === this.activeDockTabs.right);

      button.classList.toggle("is-active", isActive);
    });

    this.refs.dockPanels.forEach((panel) => {
      const key = panel.dataset.dockPanel;
      const isActive =
        key === `left:${this.activeDockTabs.left}` ||
        key === `right:${this.activeDockTabs.right}`;

      panel.classList.toggle("is-active", isActive);
    });
  }

  private syncExportModeButtons(): void {
    this.refs.exportModeButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.exportMode === this.exportMode);
    });
  }

  private syncTransformButtons(): void {
    const currentMode = this.scene.getTransformMode();
    this.refs.transformButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.transformMode === currentMode);
    });
  }

  private syncHistoryButtons(): void {
    this.refs.undoButton.disabled = !this.store.canUndo;
    this.refs.redoButton.disabled = !this.store.canRedo;
  }

  private setDockTab(group: DockGroup, tab: string): void {
    if (group === "left" && (tab === "scene" || tab === "insert")) {
      this.activeDockTabs.left = tab;
    }

    if (group === "right" && (tab === "inspector" || tab === "fields" || tab === "export")) {
      this.activeDockTabs.right = tab;
    }

    this.syncDockTabs();
  }

  private handleUndo(): void {
    const didUndo = this.store.undo();
    if (didUndo) {
      this.setStatus("Undo aplicado.");
    }
  }

  private handleRedo(): void {
    const didRedo = this.store.redo();
    if (didRedo) {
      this.setStatus("Redo aplicado.");
    }
  }

  private handleCopy(): void {
    const selectedNode = this.store.selectedNode;
    if (!selectedNode || selectedNode.id === ROOT_NODE_ID) {
      this.setStatus("Selecione um objeto para copiar.");
      return;
    }

    this.nodeClipboard = {
      sourceNodeId: selectedNode.id,
      nodes: this.collectSubtreeNodes(selectedNode.id),
    };

    this.setStatus(`Copiado: ${selectedNode.name}`);
  }

  private handlePaste(): void {
    if (!this.nodeClipboard) {
      this.setStatus("Nada copiado ainda.");
      return;
    }

    const targetParentId = this.resolvePasteTargetParentId();
    const pastedId = this.store.pasteNodes(this.nodeClipboard.nodes, targetParentId);
    if (!pastedId) {
      this.setStatus("Nao foi possivel colar aqui.");
      return;
    }

    this.activeDockTabs.right = "inspector";
    this.syncDockTabs();
    this.scene.frameSelection();
    this.setStatus("Objeto colado.");
  }

  private createFontSection(node: TextNode): HTMLElement {
    const section = document.createElement("section");
    section.className = "field-section";
    section.innerHTML = `<h4>Font</h4>`;

    const field = document.createElement("label");
    field.className = "field-block";
    field.innerHTML = `<span class="field-block__label">Active Font</span>`;

    const select = document.createElement("select");
    select.className = "editor-select";

    for (const font of this.store.fonts) {
      const option = document.createElement("option");
      option.value = font.id;
      option.textContent = font.name;
      option.selected = font.id === node.fontId;
      select.appendChild(option);
    }

    select.addEventListener("change", () => {
      this.store.updateTextNodeFont(node.id, select.value);
    });

    field.appendChild(select);

    const help = document.createElement("p");
    help.className = "field-help";
    help.textContent = `${this.store.fonts.length} fontes disponiveis. A pasta public/assets/fonts ja entra como biblioteca inicial.`;

    const importButton = document.createElement("button");
    importButton.type = "button";
    importButton.className = "tool-button";
    importButton.textContent = "Importar outra fonte";
    importButton.addEventListener("click", () => {
      this.refs.fontImportInput.click();
    });

    select.dataset.focusKey = `inspector:${node.id}:font`;
    section.append(field, help, importButton);
    return section;
  }

  private createImageSection(node: ImageNode): HTMLElement {
    const section = document.createElement("section");
    section.className = "field-section";
    section.innerHTML = `<h4>Image</h4>`;

    const preview = document.createElement("div");
    preview.className = "image-preview";

    const image = document.createElement("img");
    image.src = node.image.src;
    image.alt = node.image.name;
    image.className = "image-preview__img";
    preview.appendChild(image);

    const meta = document.createElement("p");
    meta.className = "field-help";
    meta.textContent = `${node.image.name} | ${node.image.width} x ${node.image.height} px`;

    const replaceButton = document.createElement("button");
    replaceButton.type = "button";
    replaceButton.className = "tool-button";
    replaceButton.textContent = "Trocar imagem";
    replaceButton.addEventListener("click", () => {
      this.openImageImportDialog({ mode: "replace", nodeId: node.id });
    });

    section.append(preview, meta, replaceButton);
    return section;
  }

  private createTextField(label: string, value: string, onInput: (value: string) => void, focusKey?: string): HTMLElement {
    const wrapper = document.createElement("label");
    wrapper.className = "field-block";
    wrapper.innerHTML = `<span class="field-block__label">${label}</span>`;

    const input = document.createElement("input");
    input.className = "editor-input";
    input.type = "text";
    input.value = value;
    if (focusKey) {
      input.dataset.focusKey = focusKey;
    }
    input.addEventListener("input", () => onInput(input.value));

    wrapper.appendChild(input);
    return wrapper;
  }

  private createPropertyField(node: EditorNode, definition: NodePropertyDefinition): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "property-row";

    const label = document.createElement("span");
    label.className = "property-row__label";
    label.textContent = definition.label;
    wrapper.appendChild(label);

    const inputHolder = document.createElement("div");
    inputHolder.className = "property-row__controls";

    const currentValue = getDisplayValue(node, definition);
    let input: HTMLInputElement | HTMLSelectElement;
    const focusKey = `property:${node.id}:${definition.path}`;

    if (definition.input === "checkbox") {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "editor-checkbox";
      checkbox.checked = Boolean(currentValue);
      checkbox.addEventListener("change", () => this.store.updateNodeProperty(node.id, definition, checkbox.checked));
      input = checkbox;
    } else if (definition.input === "select") {
      const select = document.createElement("select");
      select.className = "editor-select";
      select.dataset.focusKey = focusKey;
      for (const option of definition.options ?? []) {
        const element = document.createElement("option");
        element.value = option.value;
        element.textContent = option.label;
        select.appendChild(element);
      }
      select.value = String(currentValue);
      select.addEventListener("change", () => this.store.updateNodeProperty(node.id, definition, select.value));
      input = select;
    } else {
      input = document.createElement("input");
      input.className = "editor-input";
      input.dataset.focusKey = focusKey;
      input.type = definition.input === "color"
        ? "color"
        : definition.input === "text"
          ? "text"
          : "number";

      if (definition.input === "color") {
        input.value = String(currentValue);
        input.addEventListener("input", () => this.store.updateNodeProperty(node.id, definition, input.value));
      } else if (definition.input === "text") {
        input.value = String(currentValue);
        input.addEventListener("input", () => this.store.updateNodeProperty(node.id, definition, input.value));
      } else {
        input.value = String(currentValue);
        if (typeof definition.step === "number") input.step = String(definition.step);
        if (typeof definition.min === "number") input.min = String(definition.min);
        if (typeof definition.max === "number") input.max = String(definition.max);
        input.addEventListener("input", () => this.store.updateNodeProperty(node.id, definition, input.value));
      }
    }

    inputHolder.appendChild(input);

    const editableToggle = document.createElement("label");
    editableToggle.className = "editable-toggle";

    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = Boolean(node.editable[definition.path]);
    toggle.addEventListener("change", () => {
      this.store.toggleEditableProperty(node.id, definition, toggle.checked);
    });

    const toggleText = document.createElement("span");
    toggleText.textContent = "Editable";

    editableToggle.append(toggle, toggleText);
    inputHolder.appendChild(editableToggle);
    wrapper.appendChild(inputHolder);

    if (node.editable[definition.path]) {
      wrapper.classList.add("is-editable");
    }

    return wrapper;
  }

  private createEditableFieldCard(entry: EditableFieldEntry): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.className = "editable-card";

    const title = document.createElement("div");
    title.className = "editable-card__title";
    title.textContent = entry.node.name;

    const path = document.createElement("div");
    path.className = "editable-card__path";
    path.textContent = entry.binding.path;

    const keyField = this.createTextField("Key", entry.binding.key, (value) => {
      this.store.updateEditableBinding(entry.node.id, entry.binding.path, { key: value });
    }, `editable:${entry.node.id}:${entry.binding.path}:key`);

    const labelField = this.createTextField("Label", entry.binding.label, (value) => {
      this.store.updateEditableBinding(entry.node.id, entry.binding.path, { label: value });
    }, `editable:${entry.node.id}:${entry.binding.path}:label`);

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "tool-button tool-button--full";
    removeButton.textContent = "Remover campo";
    removeButton.addEventListener("click", () => {
      const definition = getPropertyDefinitions(entry.node).find((item) => item.path === entry.binding.path);
      if (!definition) return;
      this.store.toggleEditableProperty(entry.node.id, definition, false);
    });

    wrapper.append(title, path, keyField, labelField, removeButton);
    return wrapper;
  }

  private setStatus(message: string): void {
    this.refs.status.textContent = message;
    window.clearTimeout(this.statusTimeout);
    this.statusTimeout = window.setTimeout(() => {
      if (this.refs.status.textContent === message) {
        this.refs.status.textContent = "Pronto.";
      }
    }, 3000);
  }

  private openImageImportDialog(target: PendingImageImport): void {
    this.pendingImageImport = target;
    this.refs.imageImportInput.click();
  }

  private createSceneTreeBranch(node: EditorNode, childrenByParent: SceneTreeChildrenMap, depth: number): HTMLElement {
    const branch = document.createElement("div");
    branch.className = `scene-tree__branch${depth === 0 ? " scene-tree__branch--root" : ""}`;

    const row = document.createElement("div");
    row.className = "scene-node";
    row.dataset.sceneRowId = node.id;
    row.tabIndex = 0;

    if (node.id === this.store.selectedNodeId) {
      row.classList.add("is-selected");
    }

    if (node.type === "group") {
      row.classList.add("is-group");
    } else {
      row.classList.add("is-mesh");
    }

    if (this.sceneTreeDropTargetId === node.id) {
      row.classList.add("is-drop-target");
    }

    const main = document.createElement("div");
    main.className = "scene-node__main";

    const label = document.createElement("span");
    label.className = "scene-node__label";
    label.textContent = node.name;

    const meta = document.createElement("span");
    meta.className = "scene-node__meta";
    meta.textContent = node.type === "group"
      ? "Container"
      : capitalizeLabel(node.type);

    main.append(label, meta);

    const type = document.createElement("span");
    type.className = "scene-node__type";
    type.textContent = getSceneNodeKindLabel(node);

    row.append(main, type);
    row.addEventListener("click", () => this.store.selectNode(node.id));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") {
        return;
      }

      event.preventDefault();
      this.store.selectNode(node.id);
    });

    if (node.id !== ROOT_NODE_ID) {
      row.draggable = true;
      row.addEventListener("dragstart", (event) => {
        this.sceneTreeDragNodeId = node.id;
        this.setSceneTreeDropTarget(null);
        if (event.dataTransfer) {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", node.id);
        }
      });

      row.addEventListener("dragend", () => {
        this.sceneTreeDragNodeId = null;
        this.setSceneTreeDropTarget(null);
      });
    }

    if (node.type === "group") {
      row.addEventListener("dragenter", (event) => {
        const draggedNodeId = this.getDraggedSceneNodeId(event);
        if (!this.canDropSceneNode(draggedNodeId, node.id)) {
          return;
        }

        event.preventDefault();
        this.setSceneTreeDropTarget(node.id);
      });

      row.addEventListener("dragover", (event) => {
        const draggedNodeId = this.getDraggedSceneNodeId(event);
        if (!this.canDropSceneNode(draggedNodeId, node.id)) {
          return;
        }

        event.preventDefault();
        if (event.dataTransfer) {
          event.dataTransfer.dropEffect = "move";
        }
        this.setSceneTreeDropTarget(node.id);
      });

      row.addEventListener("dragleave", (event) => {
        const relatedTarget = event.relatedTarget;
        if (relatedTarget instanceof Node && row.contains(relatedTarget)) {
          return;
        }

        if (this.sceneTreeDropTargetId === node.id) {
          this.setSceneTreeDropTarget(null);
        }
      });

      row.addEventListener("drop", (event) => {
        event.preventDefault();
        event.stopPropagation();

        const draggedNodeId = this.getDraggedSceneNodeId(event);
        const movedNode = draggedNodeId ? this.store.getNode(draggedNodeId) : undefined;
        const didReparent = draggedNodeId
          ? this.store.reparentNode(draggedNodeId, node.id)
          : false;

        this.sceneTreeDragNodeId = null;
        this.setSceneTreeDropTarget(null);

        if (!didReparent || !movedNode) {
          return;
        }

        this.setStatus(`${movedNode.name} agora pertence a ${node.name}.`);
      });
    }

    branch.appendChild(row);

    const children = childrenByParent.get(node.id) ?? [];
    if (children.length > 0) {
      const childContainer = document.createElement("div");
      childContainer.className = "scene-tree__children";

      for (const child of children) {
        childContainer.appendChild(this.createSceneTreeBranch(child, childrenByParent, depth + 1));
      }

      branch.appendChild(childContainer);
    }

    return branch;
  }

  private getDraggedSceneNodeId(event: DragEvent): string | null {
    const dataTransfer = event.dataTransfer;
    return this.sceneTreeDragNodeId
      ?? dataTransfer?.getData("text/plain")
      ?? null;
  }

  private canDropSceneNode(nodeId: string | null, targetParentId: string): boolean {
    if (!nodeId || nodeId === ROOT_NODE_ID) {
      return false;
    }

    const node = this.store.getNode(nodeId);
    const targetParent = this.store.getNode(targetParentId);
    if (!node || !targetParent || targetParent.type !== "group") {
      return false;
    }

    if (node.id === targetParentId || node.parentId === targetParentId) {
      return false;
    }

    return !this.store.getDescendantIds(nodeId).includes(targetParentId);
  }

  private setSceneTreeDropTarget(nodeId: string | null): void {
    if (this.sceneTreeDropTargetId === nodeId) {
      return;
    }

    if (this.sceneTreeDropTargetId) {
      this.refs.sceneTree
        .querySelector<HTMLElement>(`[data-scene-row-id="${this.sceneTreeDropTargetId}"]`)
        ?.classList.remove("is-drop-target");
    }

    this.sceneTreeDropTargetId = nodeId;

    if (nodeId) {
      this.refs.sceneTree
        .querySelector<HTMLElement>(`[data-scene-row-id="${nodeId}"]`)
        ?.classList.add("is-drop-target");
    }
  }

  private collectSubtreeNodes(rootNodeId: string): EditorNode[] {
    const nodeIds = new Set([rootNodeId, ...this.store.getDescendantIds(rootNodeId)]);
    return this.store.blueprint.nodes
      .filter((node) => nodeIds.has(node.id))
      .map((node) => structuredClone(node));
  }

  private resolvePasteTargetParentId(): string | null {
    const selectedNode = this.store.selectedNode;
    if (!selectedNode) {
      return ROOT_NODE_ID;
    }

    if (selectedNode.type === "group" && selectedNode.id !== this.nodeClipboard?.sourceNodeId) {
      return selectedNode.id;
    }

    return selectedNode.parentId ?? ROOT_NODE_ID;
  }

  private captureFocusSnapshot(): FocusSnapshot | null {
    const activeElement = document.activeElement;
    if (!(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement)) {
      return null;
    }

    const key = activeElement.dataset.focusKey;
    if (!key) {
      return null;
    }

    const selectionStart = "selectionStart" in activeElement ? activeElement.selectionStart : null;
    const selectionEnd = "selectionEnd" in activeElement ? activeElement.selectionEnd : null;

    return {
      key,
      selectionStart,
      selectionEnd,
    };
  }

  private restoreFocusSnapshot(snapshot: FocusSnapshot | null): void {
    if (!snapshot) {
      return;
    }

    const nextField = this.root.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[data-focus-key="${snapshot.key}"]`);
    if (!nextField) {
      return;
    }

    nextField.focus({ preventScroll: true });

    if (!(nextField instanceof HTMLInputElement || nextField instanceof HTMLTextAreaElement)) {
      return;
    }

    if (snapshot.selectionStart === null || snapshot.selectionEnd === null) {
      return;
    }

    try {
      nextField.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    } catch {
      // Some input types such as color/number do not support selection ranges.
    }
  }
}

function createLayout(): string {
  return `
    <div class="editor-app">
      <header class="app-topbar">
        <div class="app-brand">
          <div class="app-brand__mark">3D</div>
          <div class="app-brand__copy">
            <p class="app-brand__eyebrow">Standalone Editor</p>
            <h1>HoloGfx Builder</h1>
          </div>
        </div>

        <label class="topbar-project">
          <span class="topbar-project__label">Component</span>
          <input id="component-name" class="editor-input editor-input--topbar" type="text" />
        </label>

        <div class="topbar-actions">
          <button id="undo-action" class="tool-button" type="button">Undo</button>
          <button id="redo-action" class="tool-button" type="button">Redo</button>
          <button id="new-blueprint" class="tool-button" type="button">Novo</button>
          <button id="restore-autosave" class="tool-button" type="button">Restaurar</button>
          <button id="import-image" class="tool-button" type="button">Importar Imagem</button>
          <button id="import-font" class="tool-button" type="button">Importar Fonte</button>
          <button id="import-blueprint" class="tool-button" type="button">Importar JSON</button>
        </div>
      </header>

      <div class="app-workspace">
        <aside class="app-dock app-dock--left">
          <div class="dock-tabbar">
            <button class="dock-tab is-active" data-dock-group="left" data-dock-tab="scene" type="button">Scene</button>
            <button class="dock-tab" data-dock-group="left" data-dock-tab="insert" type="button">Insert</button>
          </div>

          <section class="dock-panel is-active" data-dock-panel="left:scene">
            <div class="dock-panel__header">
              <div>
                <h2>Scene Graph</h2>
                <p id="scene-summary">0 nodes na cena</p>
              </div>
            </div>
            <div class="dock-panel__body">
              <div id="scene-tree" class="scene-tree"></div>
            </div>
          </section>

          <section class="dock-panel" data-dock-panel="left:insert">
            <div class="dock-panel__header">
              <div>
                <h2>Insert</h2>
                <p>Crie novos blocos para montar o componente.</p>
              </div>
            </div>
            <div class="dock-panel__body dock-panel__body--stack">
              <section class="tool-section">
                <h3>Quick Create</h3>
                <div class="insert-grid">
                  <button class="tool-button" data-create-node="group" type="button">+ Group</button>
                  <button class="tool-button" data-create-node="box" type="button">+ Box</button>
                  <button class="tool-button" data-create-node="sphere" type="button">+ Sphere</button>
                  <button class="tool-button" data-create-node="cylinder" type="button">+ Cylinder</button>
                  <button class="tool-button" data-create-node="plane" type="button">+ Plane</button>
                  <button class="tool-button" data-create-node="image" type="button">+ Image</button>
                  <button class="tool-button" data-create-node="text" type="button">+ Text</button>
                  <button id="delete-node" class="tool-button tool-button--danger" type="button">Delete</button>
                </div>
              </section>

              <section class="tool-section">
                <h3>Tips</h3>
                <div class="shortcut-list">
                  <div class="shortcut-item"><span>1</span><span>Select</span></div>
                  <div class="shortcut-item"><span>2</span><span>Move gizmo</span></div>
                  <div class="shortcut-item"><span>3</span><span>Rotate gizmo</span></div>
                  <div class="shortcut-item"><span>4</span><span>Scale gizmo</span></div>
                  <div class="shortcut-item"><span>Ctrl+C</span><span>Copy selection</span></div>
                  <div class="shortcut-item"><span>Ctrl+V</span><span>Paste copy</span></div>
                  <div class="shortcut-item"><span>Ctrl+Z</span><span>Undo</span></div>
                  <div class="shortcut-item"><span>Ctrl+Y</span><span>Redo</span></div>
                  <div class="shortcut-item"><span>F</span><span>Frame selection</span></div>
                  <div class="shortcut-item"><span>Delete</span><span>Remove selection</span></div>
                </div>
              </section>
            </div>
          </section>
        </aside>

        <main class="app-stage">
          <div id="viewport" class="viewport-canvas"></div>

          <div class="stage-toolbar">
            <div class="stage-toolbar__group">
              <div id="selection-meta" class="stage-chip">Nenhum no selecionado</div>
              <div id="node-count-meta" class="stage-chip stage-chip--muted">0 nodes</div>
            </div>

            <div class="stage-toolbar__group">
              <div class="toolbar-cluster">
                <button class="tool-button is-active" data-transform-mode="select" type="button">Select</button>
                <button class="tool-button" data-transform-mode="translate" type="button">Move</button>
                <button class="tool-button" data-transform-mode="rotate" type="button">Rotate</button>
                <button class="tool-button" data-transform-mode="scale" type="button">Scale</button>
              </div>
              <button id="frame-selection" class="tool-button tool-button--accent" type="button">Frame</button>
            </div>
          </div>

          <div class="stage-footer">
            <div id="editor-status" class="status-pill">Pronto.</div>
            <div class="shortcut-strip">
              <span class="hint-chip">1 select</span>
              <span class="hint-chip">2 move</span>
              <span class="hint-chip">3 rotate</span>
              <span class="hint-chip">4 scale</span>
              <span class="hint-chip">Ctrl+C copy</span>
              <span class="hint-chip">Ctrl+V paste</span>
              <span class="hint-chip">F frame</span>
            </div>
          </div>
        </main>

        <aside class="app-dock app-dock--right">
          <div class="dock-tabbar">
            <button class="dock-tab is-active" data-dock-group="right" data-dock-tab="inspector" type="button">Inspector</button>
            <button class="dock-tab" data-dock-group="right" data-dock-tab="fields" type="button">Fields</button>
            <button class="dock-tab" data-dock-group="right" data-dock-tab="export" type="button">Export</button>
          </div>

          <section class="dock-panel is-active" data-dock-panel="right:inspector">
            <div class="dock-panel__header">
              <div>
                <h2>Inspector</h2>
                <p>Transform, geometry e material do no selecionado.</p>
              </div>
            </div>
            <div class="dock-panel__body">
              <div id="inspector" class="inspector"></div>
            </div>
          </section>

          <section class="dock-panel" data-dock-panel="right:fields">
            <div class="dock-panel__header">
              <div>
                <h2>Runtime Fields</h2>
                <p id="fields-summary">0 campos em runtime</p>
              </div>
            </div>
            <div class="dock-panel__body">
              <div id="editable-fields" class="editable-fields"></div>
            </div>
          </section>

          <section class="dock-panel" data-dock-panel="right:export">
            <div class="dock-panel__header">
              <div>
                <h2>Export</h2>
                <p>JSON para reabrir. TypeScript para usar no projeto.</p>
              </div>
            </div>
            <div class="dock-panel__body">
              <div class="export-stack">
                <div class="export-toolbar">
                  <div class="button-row">
                    <button class="dock-tab is-active" data-export-mode="json" type="button">Blueprint JSON</button>
                    <button class="dock-tab" data-export-mode="typescript" type="button">TypeScript</button>
                  </div>
                  <div class="button-row">
                    <button id="copy-export" class="tool-button" type="button">Copiar</button>
                    <button id="download-export" class="tool-button" type="button">Download</button>
                  </div>
                </div>
                <textarea id="export-preview" class="export-preview" readonly spellcheck="false"></textarea>
              </div>
            </div>
          </section>
        </aside>
      </div>

      <input id="import-blueprint-input" type="file" accept=".json,application/json" hidden />
      <input id="import-font-input" type="file" accept=".json,.typeface.json,.ttf,.otf" hidden />
      <input id="import-image-input" type="file" accept="image/png,image/webp,image/jpeg,image/svg+xml,.png,.webp,.jpg,.jpeg,.svg" hidden />
    </div>
  `;
}

function groupDefinitions(definitions: NodePropertyDefinition[]): Map<string, NodePropertyDefinition[]> {
  const groups = new Map<string, NodePropertyDefinition[]>();

  for (const definition of definitions) {
    const bucket = groups.get(definition.group) ?? [];
    bucket.push(definition);
    groups.set(definition.group, bucket);
  }

  return groups;
}

function getSceneNodeKindLabel(node: EditorNode): string {
  return node.type === "group" ? "Group" : "Mesh";
}

function capitalizeLabel(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function downloadText(fileName: string, content: string): void {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
