import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { exportBlueprintToJson, generateTypeScriptComponent } from "../exports";
import { fontFileToAsset } from "../fonts";
import { imageFileToAsset } from "../images";
import { SceneEditor } from "../scene";
import {
  createDefaultBlueprint,
  EDITOR_AUTOSAVE_KEY,
  EditorStore,
  ROOT_NODE_ID,
  getPropertyDefinitions,
} from "../state";
import type { EditorNode, EditorNodeType, ImageAsset } from "../types";
import type { ContextMenuState, ExportMode, MenuAction, RightPanelTab, ToolMode, TreeDropTarget } from "./ui-types";
import { useEditorStoreSnapshot } from "./hooks/useEditorStoreSnapshot";
import { useGlobalHotkeys } from "./hooks/useGlobalHotkeys";
import { ContextMenu } from "./components/ContextMenu";
import { ExportPanel } from "./components/ExportPanel";
import { FieldsPanel } from "./components/FieldsPanel";
import {
  CopyIcon,
  FileIcon,
  FrameIcon,
  InfoIcon,
  TrashIcon,
  ShortcutIcon,
  GroupIcon,
  MeshIcon,
  ImagePropertyIcon,
  TextPropertyIcon,
  UndoIcon,
  RedoIcon,
} from "./components/icons";
import { InspectorPanel } from "./components/InspectorPanel";
import { MenuBar } from "./components/MenuBar";
import { Modal } from "./components/Modal";
import { SceneGraphPanel } from "./components/SceneGraphPanel";
import { SecondaryToolbar } from "./components/SecondaryToolbar";
import { ShortcutDialog } from "./components/ShortcutDialog";
import { ViewportHost } from "./components/ViewportHost";

interface NodeClipboard {
  sourceNodeId: string;
  nodes: EditorNode[];
}

type PendingImageImport =
  | { mode: "create"; parentId: string; index?: number }
  | { mode: "replace"; nodeId: string };

interface InsertTarget {
  parentId: string;
  index?: number;
}

interface AutosaveBootState {
  autosaveEnabled: boolean;
  hasAutosave: boolean;
  initialBlueprint: unknown;
}

const AUTOSAVE_ENABLED_KEY = "3forge-autosave-enabled";

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readAutosaveEnabledPreference(): boolean {
  if (!canUseLocalStorage()) {
    return true;
  }

  return window.localStorage.getItem(AUTOSAVE_ENABLED_KEY) !== "false";
}

function readStoredAutosaveBlueprint(): unknown | null {
  if (!canUseLocalStorage()) {
    return null;
  }

  const raw = window.localStorage.getItem(EDITOR_AUTOSAVE_KEY);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    window.localStorage.removeItem(EDITOR_AUTOSAVE_KEY);
    return null;
  }
}

function getAutosaveBootState(): AutosaveBootState {
  const autosaveEnabled = readAutosaveEnabledPreference();
  const storedBlueprint = readStoredAutosaveBlueprint();

  return {
    autosaveEnabled,
    hasAutosave: storedBlueprint !== null,
    initialBlueprint: autosaveEnabled ? (storedBlueprint ?? createDefaultBlueprint()) : createDefaultBlueprint(),
  };
}

export function App() {
  const [bootState] = useState(getAutosaveBootState);
  const [store] = useState(() => new EditorStore(bootState.initialBlueprint));
  const [autosaveEnabled, setAutosaveEnabled] = useState(bootState.autosaveEnabled);
  const [hasAutosave, setHasAutosave] = useState(bootState.hasAutosave);
  const storeView = useEditorStoreSnapshot(store);
  const [exportMode, setExportMode] = useState<ExportMode>("typescript");
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("inspector");
  const [currentTool, setCurrentTool] = useState<ToolMode>("select");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [statusText, setStatusText] = useState("Ready");
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [statusTick, setStatusTick] = useState(0);

  const sceneRef = useRef<SceneEditor | null>(null);
  const clipboardRef = useRef<NodeClipboard | null>(null);
  const pendingImageImportRef = useRef<PendingImageImport | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fontInputRef = useRef<HTMLInputElement | null>(null);

  const blueprintSnapshot = useMemo(() => store.getSnapshot(), [store, storeView]);
  const blueprintJson = useMemo(() => exportBlueprintToJson(blueprintSnapshot), [blueprintSnapshot]);
  const typeScriptExport = useMemo(() => generateTypeScriptComponent(blueprintSnapshot), [blueprintSnapshot]);
  const exportPreview = exportMode === "json" ? blueprintJson : typeScriptExport;
  const selectedNode = storeView.selectedNode;

  const setTransientStatus = useCallback((message: string) => {
    setStatusText(message);
    setStatusTick((value) => value + 1);
    if (statusTimerRef.current) {
      window.clearTimeout(statusTimerRef.current);
    }

    statusTimerRef.current = window.setTimeout(() => {
      setStatusText("Ready");
      statusTimerRef.current = null;
    }, 2200);
  }, []);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }

    window.localStorage.setItem(AUTOSAVE_ENABLED_KEY, autosaveEnabled ? "true" : "false");
  }, [autosaveEnabled]);

  useEffect(() => {
    if (!autosaveEnabled || !canUseLocalStorage()) {
      return;
    }

    window.localStorage.setItem(EDITOR_AUTOSAVE_KEY, blueprintJson);
    setHasAutosave(true);
  }, [autosaveEnabled, blueprintJson]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
      }
    };
  }, []);

  const getSiblingIndex = useCallback((nodeId: string) => {
    const node = store.getNode(nodeId);
    if (!node) {
      return 0;
    }

    return store.getNodeChildren(node.parentId).findIndex((entry) => entry.id === nodeId);
  }, [store]);

  const collectSubtreeNodes = useCallback((rootNodeId: string) => {
    const ids = new Set([rootNodeId, ...store.getDescendantIds(rootNodeId)]);
    return store.blueprint.nodes.filter((node) => ids.has(node.id));
  }, [store]);

  const resolveSelectionInsertTarget = useCallback((): InsertTarget => {
    if (!selectedNode) {
      return { parentId: ROOT_NODE_ID };
    }

    if (selectedNode.type === "group") {
      return {
        parentId: selectedNode.id,
        index: store.getNodeChildren(selectedNode.id).length,
      };
    }

    return {
      parentId: selectedNode.parentId ?? ROOT_NODE_ID,
      index: getSiblingIndex(selectedNode.id) + 1,
    };
  }, [getSiblingIndex, selectedNode, store]);

  const resolveContextInsertTarget = useCallback((nodeId: string | null): InsertTarget => {
    if (!nodeId) {
      return resolveSelectionInsertTarget();
    }

    const node = store.getNode(nodeId);
    if (!node) {
      return resolveSelectionInsertTarget();
    }

    if (node.type === "group") {
      return {
        parentId: node.id,
        index: store.getNodeChildren(node.id).length,
      };
    }

    return {
      parentId: node.parentId ?? ROOT_NODE_ID,
      index: getSiblingIndex(node.id) + 1,
    };
  }, [getSiblingIndex, resolveSelectionInsertTarget, store]);

  const requestImageImport = useCallback((target: PendingImageImport) => {
    pendingImageImportRef.current = target;
    imageInputRef.current?.click();
  }, []);

  const handleToolChange = useCallback((mode: ToolMode) => {
    setCurrentTool(mode);
    sceneRef.current?.setTransformMode(mode);
    setTransientStatus(mode === "select" ? "Selection tool active." : `${mode} tool active.`);
  }, [setTransientStatus]);

  const handleFrameSelection = useCallback(() => {
    sceneRef.current?.frameSelection();
    setTransientStatus("Framed selection.");
  }, [setTransientStatus]);

  const handleCopy = useCallback(() => {
    if (!selectedNode || selectedNode.id === ROOT_NODE_ID) {
      return;
    }

    clipboardRef.current = {
      sourceNodeId: selectedNode.id,
      nodes: collectSubtreeNodes(selectedNode.id),
    };
    setTransientStatus(`Copied "${selectedNode.name}".`);
  }, [collectSubtreeNodes, selectedNode, setTransientStatus]);

  const handlePaste = useCallback((targetNodeId?: string | null) => {
    const clipboard = clipboardRef.current;
    if (!clipboard) {
      return;
    }

    const target = resolveContextInsertTarget(targetNodeId ?? null);
    const newRootId = store.pasteNodes(clipboard.nodes, target.parentId);
    if (!newRootId) {
      return;
    }

    if (typeof target.index === "number") {
      store.moveNode(newRootId, target.parentId, target.index);
    }

    const pasted = store.getNode(newRootId);
    setTransientStatus(pasted ? `Pasted "${pasted.name}".` : "Pasted selection.");
  }, [resolveContextInsertTarget, setTransientStatus, store]);

  const handleDelete = useCallback((nodeId?: string) => {
    const targetId = nodeId ?? storeView.selectedNodeId;
    if (targetId === ROOT_NODE_ID) {
      return;
    }

    const node = store.getNode(targetId);
    if (!node) {
      return;
    }

    store.deleteNode(targetId);
    setTransientStatus(`Deleted "${node.name}".`);
  }, [setTransientStatus, store, storeView.selectedNodeId]);

  const handleDuplicate = useCallback((nodeId?: string | null) => {
    const targetId = nodeId ?? storeView.selectedNodeId;
    if (!targetId || targetId === ROOT_NODE_ID) {
      return;
    }

    const node = store.getNode(targetId);
    if (!node) {
      return;
    }

    const newRootId = store.pasteNodes(collectSubtreeNodes(targetId), node.parentId ?? ROOT_NODE_ID);
    if (!newRootId) {
      return;
    }

    store.moveNode(newRootId, node.parentId ?? ROOT_NODE_ID, getSiblingIndex(targetId) + 1);
    const duplicated = store.getNode(newRootId);
    setTransientStatus(duplicated ? `Duplicated "${duplicated.name}".` : "Duplicated selection.");
  }, [collectSubtreeNodes, getSiblingIndex, setTransientStatus, store, storeView.selectedNodeId]);

  const createAddMenuActions = useCallback((resolveTarget: () => InsertTarget): MenuAction[] => {
    const createNodeAction = (type: Exclude<EditorNodeType, "image">) => () => {
      const target = resolveTarget();
      store.insertNode(type, target.parentId, target.index);
      setTransientStatus(`Added ${type}.`);
    };

    const iconSize = { width: 14, height: 14 };

    return [
      { id: "add-group", label: "Group", icon: <GroupIcon {...iconSize} />, onSelect: createNodeAction("group") },
      { id: "add-box", label: "Box", icon: <MeshIcon {...iconSize} />, onSelect: createNodeAction("box") },
      { id: "add-sphere", label: "Sphere", icon: <MeshIcon {...iconSize} />, onSelect: createNodeAction("sphere") },
      { id: "add-cylinder", label: "Cylinder", icon: <MeshIcon {...iconSize} />, onSelect: createNodeAction("cylinder") },
      { id: "add-plane", label: "Plane", icon: <MeshIcon {...iconSize} />, onSelect: createNodeAction("plane") },
      {
        id: "add-image",
        label: "Image",
        icon: <ImagePropertyIcon {...iconSize} />,
        onSelect: () => {
          const target = resolveTarget();
          requestImageImport({ mode: "create", parentId: target.parentId, index: target.index });
        },
      },
      { id: "add-text", label: "Text", icon: <TextPropertyIcon {...iconSize} />, onSelect: createNodeAction("text") },
    ];
  }, [requestImageImport, setTransientStatus, store]);

  const downloadExportFile = useCallback((mode: ExportMode) => {
    const content = mode === "json" ? blueprintJson : typeScriptExport;
    const extension = mode === "json" ? "json" : "ts";
    const fileName = `${blueprintSnapshot.componentName || "3forge-component"}.${extension}`;
    const blob = new Blob([content], { type: mode === "json" ? "application/json" : "text/plain" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
    setTransientStatus(`Downloaded ${fileName}.`);
  }, [blueprintJson, blueprintSnapshot.componentName, setTransientStatus, typeScriptExport]);

  const copyExportText = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(exportPreview);
      setTransientStatus("Export copied.");
    } catch {
      setTransientStatus("Unable to copy export.");
    }
  }, [exportPreview, setTransientStatus]);

  const importJsonFromFile = useCallback(async (file: File) => {
    const text = await file.text();
    store.loadBlueprint(JSON.parse(text));
    setTransientStatus(`Imported ${file.name}.`);
  }, [setTransientStatus, store]);

  const importFontFromFile = useCallback(async (file: File) => {
    const font = await fontFileToAsset(file);
    store.addFont(font);
    setTransientStatus(`Imported font "${font.name}".`);
  }, [setTransientStatus, store]);

  const applyImageImport = useCallback((image: ImageAsset) => {
    const pending = pendingImageImportRef.current;
    pendingImageImportRef.current = null;
    if (!pending) {
      const target = resolveSelectionInsertTarget();
      store.insertImageNode(image, target.parentId, target.index);
      return;
    }

    if (pending.mode === "replace") {
      store.updateImageNodeAsset(pending.nodeId, image);
      setTransientStatus(`Replaced image with "${image.name}".`);
      return;
    }

    store.insertImageNode(image, pending.parentId, pending.index);
    setTransientStatus(`Imported image "${image.name}".`);
  }, [resolveSelectionInsertTarget, setTransientStatus, store]);

  const handleNewBlueprint = useCallback(() => {
    store.loadBlueprint(createDefaultBlueprint(), "ui");
    setTransientStatus("Created new blueprint.");
  }, [setTransientStatus, store]);

  const handleRestoreAutosave = useCallback(() => {
    const storedBlueprint = readStoredAutosaveBlueprint();
    if (!storedBlueprint) {
      setHasAutosave(false);
      setTransientStatus("No autosave found.");
      return;
    }

    store.loadBlueprint(storedBlueprint);
    setTransientStatus("Autosave restored.");
  }, [setTransientStatus, store]);

  const handleToggleAutosave = useCallback(() => {
    const nextValue = !autosaveEnabled;
    setAutosaveEnabled(nextValue);
    setTransientStatus(nextValue ? "Autosave enabled." : "Autosave disabled.");
  }, [autosaveEnabled, setTransientStatus]);

  const handleSceneMove = useCallback((nodeId: string, target: TreeDropTarget) => {
    if (store.moveNode(nodeId, target.parentId, target.index)) {
      const node = store.getNode(nodeId);
      setTransientStatus(node ? `Moved "${node.name}".` : "Moved node.");
    }
  }, [setTransientStatus, store]);

  const openSceneGraphContextMenu = useCallback((event: MouseEvent, nodeId: string | null) => {
    if (nodeId) {
      store.selectNode(nodeId);
    }

    const targetNode = nodeId ? store.getNode(nodeId) : null;
    const addActions = createAddMenuActions(() => resolveContextInsertTarget(nodeId));
    const items: MenuAction[] = [
      { id: "ctx-new", label: "New", icon: <MeshIcon width={14} height={14} />, children: addActions },
      { id: "ctx-paste", label: "Paste", icon: <FileIcon width={14} height={14} />, shortcut: "Ctrl+V", disabled: !clipboardRef.current, onSelect: () => handlePaste(nodeId) },
      { id: "ctx-divider-1", separator: true },
      { id: "ctx-duplicate", label: "Duplicate", icon: <CopyIcon width={14} height={14} />, shortcut: "Ctrl+C / Ctrl+V", disabled: !targetNode || targetNode.id === ROOT_NODE_ID, onSelect: () => handleDuplicate(nodeId) },
      { id: "ctx-frame", label: "Frame", icon: <FrameIcon width={14} height={14} />, shortcut: "F", disabled: !targetNode, onSelect: () => { if (nodeId) store.selectNode(nodeId); handleFrameSelection(); } },
      { id: "ctx-delete", label: "Delete", icon: <TrashIcon width={14} height={14} />, shortcut: "Delete", danger: true, disabled: !targetNode || targetNode.id === ROOT_NODE_ID, onSelect: () => handleDelete(nodeId ?? undefined) },
    ];

    setContextMenu({ x: event.clientX, y: event.clientY, items });
  }, [createAddMenuActions, handleDelete, handleDuplicate, handleFrameSelection, handlePaste, resolveContextInsertTarget, store]);

  const openViewportContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nodeId = sceneRef.current?.getNodeIdAtClientPoint(event.clientX, event.clientY) ?? null;
    openSceneGraphContextMenu(event, nodeId);
  }, [openSceneGraphContextMenu]);

  useGlobalHotkeys({
    onUndo: () => {
      if (store.undo()) {
        setTransientStatus("Undo.");
      }
    },
    onRedo: () => {
      if (store.redo()) {
        setTransientStatus("Redo.");
      }
    },
    onCopy: handleCopy,
    onPaste: () => handlePaste(),
    onDelete: () => handleDelete(),
    onFrame: handleFrameSelection,
    onToolChange: handleToolChange,
  });

  const menus = useMemo(() => [
    {
      id: "file",
      label: "File",
      items: [
        { id: "file-new", label: "New Blueprint", icon: <FileIcon width={14} height={14} />, shortcut: "Ctrl+N", onSelect: handleNewBlueprint },
        { id: "file-restore", label: "Restore Autosave", icon: <UndoIcon width={14} height={14} />, disabled: !hasAutosave, onSelect: handleRestoreAutosave },
        { id: "file-divider-1", separator: true },
        { id: "file-import-json", label: "Import JSON", icon: <FileIcon width={14} height={14} />, onSelect: () => jsonInputRef.current?.click() },
        { id: "file-import-image", label: "Import Image", icon: <ImagePropertyIcon width={14} height={14} />, onSelect: () => requestImageImport({ mode: "create", ...resolveSelectionInsertTarget() }) },
        { id: "file-import-font", label: "Import Font", icon: <TextPropertyIcon width={14} height={14} />, onSelect: () => fontInputRef.current?.click() },
        { id: "file-divider-2", separator: true },
        { id: "file-export-json", label: "Download Blueprint JSON", onSelect: () => downloadExportFile("json") },
        { id: "file-export-ts", label: "Download TypeScript", onSelect: () => downloadExportFile("typescript") },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "edit-undo", label: "Undo", icon: <UndoIcon width={14} height={14} />, shortcut: "Ctrl+Z", disabled: !storeView.canUndo, onSelect: () => store.undo() },
        { id: "edit-redo", label: "Redo", icon: <RedoIcon width={14} height={14} />, shortcut: "Ctrl+Y", disabled: !storeView.canRedo, onSelect: () => store.redo() },
        { id: "edit-divider-1", separator: true },
        { id: "edit-copy", label: "Copy", icon: <CopyIcon width={14} height={14} />, shortcut: "Ctrl+C", disabled: !selectedNode || selectedNode.id === ROOT_NODE_ID, onSelect: handleCopy },
        { id: "edit-paste", label: "Paste", icon: <FileIcon width={14} height={14} />, shortcut: "Ctrl+V", disabled: !clipboardRef.current, onSelect: () => handlePaste() },
        { id: "edit-delete", label: "Delete", icon: <TrashIcon width={14} height={14} />, shortcut: "Delete", danger: true, disabled: !selectedNode || selectedNode.id === ROOT_NODE_ID, onSelect: () => handleDelete() },
        { id: "edit-divider-2", separator: true },
        { id: "edit-frame", label: "Frame Selection", icon: <FrameIcon width={14} height={14} />, shortcut: "F", disabled: !selectedNode, onSelect: handleFrameSelection },
      ],
    },
    {
      id: "add",
      label: "Add",
      items: createAddMenuActions(resolveSelectionInsertTarget),
    },
    {
      id: "help",
      label: "Help",
      items: [
        { id: "help-shortcuts", label: "Shortcuts", icon: <ShortcutIcon width={14} height={14} />, onSelect: () => setIsShortcutDialogOpen(true) },
        { id: "help-about", label: "About 3Forge", icon: <InfoIcon width={14} height={14} />, onSelect: () => setIsAboutDialogOpen(true) },
      ],
    },
  ], [
    autosaveEnabled,
    createAddMenuActions,
    downloadExportFile,
    handleCopy,
    handleDelete,
    handleFrameSelection,
    handleNewBlueprint,
    handlePaste,
    handleRestoreAutosave,
    hasAutosave,
    requestImageImport,
    resolveSelectionInsertTarget,
    selectedNode,
    store,
    storeView.canRedo,
    storeView.canUndo,
  ]);

  return (
    <div className="app-shell" data-status-tick={statusTick}>
      <MenuBar menus={menus} />

      <SecondaryToolbar
        componentName={storeView.blueprintComponentName}
        selectedLabel={selectedNode ? `${selectedNode.name} | ${selectedNode.type === "group" ? "Group" : "Mesh"}` : "No selection"}
        nodeCount={storeView.blueprintNodes.length}
        canUndo={storeView.canUndo}
        canRedo={storeView.canRedo}
        currentTool={currentTool}
        onComponentNameChange={(value) => store.updateComponentName(value)}
        onUndo={() => { if (store.undo()) setTransientStatus("Undo."); }}
        onRedo={() => { if (store.redo()) setTransientStatus("Redo."); }}
        onToolChange={handleToolChange}
        onFrame={handleFrameSelection}
      />

      <div className="workspace">
        <main className="viewport-panel">
          <div className="viewport-panel__header viewport-panel__header--compact">
            <span className="viewport-panel__title">Viewport</span>
            <div className="viewport-panel__badges">
              <span className="badge">{currentTool}</span>
              <span className="badge">{storeView.blueprintNodes.length} items</span>
            </div>
          </div>

          <div className="viewport-panel__body">
            <ViewportHost
              store={store}
              onSceneReady={(scene) => {
                sceneRef.current = scene;
                scene?.setTransformMode(currentTool);
              }}
              onContextMenu={openViewportContextMenu}
            />
          </div>
        </main>

        <aside className="panel panel--right panel--split">
          <section className="panel-split__top">
            <div className="panel__header">
              <p className="panel__eyebrow">Hierarchy</p>
              <span className="panel__meta">{storeView.blueprintNodes.length} items</span>
            </div>

            <div className="panel__body panel__body--flush">
              <SceneGraphPanel
                nodes={storeView.blueprintNodes}
                selectedNodeId={storeView.selectedNodeId}
                onSelectNode={(nodeId) => store.selectNode(nodeId)}
                onMoveNode={handleSceneMove}
                onContextMenu={openSceneGraphContextMenu}
              />
            </div>
          </section>

          <section className="panel-split__bottom">
            <div className="panel-tabs">
              <button type="button" className={`panel-tab${rightPanelTab === "inspector" ? " is-active" : ""}`} onClick={() => setRightPanelTab("inspector")}>Inspector</button>
              <button type="button" className={`panel-tab${rightPanelTab === "fields" ? " is-active" : ""}`} onClick={() => setRightPanelTab("fields")}>Fields</button>
              <button type="button" className={`panel-tab${rightPanelTab === "export" ? " is-active" : ""}`} onClick={() => setRightPanelTab("export")}>Export</button>
            </div>

            <div className="panel__body">
              {rightPanelTab === "inspector" ? (
                <InspectorPanel
                  node={selectedNode}
                  fonts={storeView.fonts}
                  onNodeNameChange={(nodeId, value) => store.updateNodeName(nodeId, value)}
                  onParentChange={(nodeId, parentId) => {
                    const eligibleChildren = store.getNodeChildren(parentId);
                    store.moveNode(nodeId, parentId, eligibleChildren.length);
                  }}
                  getEligibleParents={(nodeId) => store.getEligibleParents(nodeId)}
                  onNodePropertyChange={(nodeId, definition, value) => store.updateNodeProperty(nodeId, definition, value)}
                  onToggleEditable={(nodeId, definition, enabled) => store.toggleEditableProperty(nodeId, definition, enabled)}
                  onTextFontChange={(nodeId, fontId) => store.updateTextNodeFont(nodeId, fontId)}
                  onImportFont={() => fontInputRef.current?.click()}
                  onReplaceImage={(nodeId) => requestImageImport({ mode: "replace", nodeId })}
                />
              ) : null}

              {rightPanelTab === "fields" ? (
                <FieldsPanel
                  entries={storeView.editableFields}
                  onUpdateBinding={(nodeId, path, patch) => store.updateEditableBinding(nodeId, path, patch)}
                  onRemoveEditable={(nodeId, path) => {
                    const node = store.getNode(nodeId);
                    const definition = node ? getPropertyDefinitions(node).find((entry) => entry.path === path) : undefined;
                    if (definition) {
                      store.toggleEditableProperty(nodeId, definition, false);
                    }
                  }}
                />
              ) : null}

              {rightPanelTab === "export" ? (
                <ExportPanel
                  exportMode={exportMode}
                  preview={exportPreview}
                  onExportModeChange={setExportMode}
                  onCopy={copyExportText}
                  onDownload={() => downloadExportFile(exportMode)}
                />
              ) : null}
            </div>
          </section>
        </aside>
      </div>

      <footer className="statusbar">
        <span className="statusbar__message">{statusText}</span>
        <div className="statusbar__right">
          <button
            type="button"
            className={`statusbar__toggle${autosaveEnabled ? " is-active" : ""}`}
            onClick={handleToggleAutosave}
          >
            autosave {autosaveEnabled ? "on" : "off"}
          </button>
          <span className="statusbar__chip">{hasAutosave ? "snapshot saved" : "no snapshot"}</span>
          <span className="statusbar__chip">{storeView.blueprintNodes.length} nodes</span>
        </div>
      </footer>

      <input
        ref={jsonInputRef}
        className="hidden-input"
        type="file"
        accept=".json"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) {
            return;
          }

          try {
            await importJsonFromFile(file);
          } catch {
            setTransientStatus("Unable to import JSON.");
          }
        }}
      />

      <input
        ref={imageInputRef}
        className="hidden-input"
        type="file"
        accept=".png,.jpg,.jpeg,.webp,.svg"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) {
            pendingImageImportRef.current = null;
            return;
          }

          try {
            const image = await imageFileToAsset(file);
            applyImageImport(image);
          } catch {
            pendingImageImportRef.current = null;
            setTransientStatus("Unable to import image.");
          }
        }}
      />

      <input
        ref={fontInputRef}
        className="hidden-input"
        type="file"
        accept=".json,.typeface.json,.ttf,.otf"
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.currentTarget.value = "";
          if (!file) {
            return;
          }

          try {
            await importFontFromFile(file);
          } catch {
            setTransientStatus("Unable to import font.");
          }
        }}
      />

      <ContextMenu state={contextMenu} onClose={() => setContextMenu(null)} />
      <ShortcutDialog isOpen={isShortcutDialogOpen} onClose={() => setIsShortcutDialogOpen(false)} />

      <Modal title="About 3Forge" isOpen={isAboutDialogOpen} onClose={() => setIsAboutDialogOpen(false)}>
        <div className="about-copy">
          <p>3Forge is a standalone 3D component editor focused on building reusable Three.js pieces with runtime-editable fields.</p>
          <p>The viewport, history, export pipeline, fonts, images, and scene state stay in the editor core. React now handles the software-like shell, menus, panels, and scene graph workflow.</p>
        </div>
      </Modal>
    </div>
  );
}
