import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
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
import type { AnimationKeyframe, AnimationPropertyPath, EditorNode, EditorNodeType, ImageAsset } from "../types";
import type { ContextMenuState, ExportMode, MenuAction, RightPanelTab, ToolMode, TreeDropTarget } from "./ui-types";
import { useEditorStoreSnapshot } from "./hooks/useEditorStoreSnapshot";
import { useGlobalHotkeys } from "./hooks/useGlobalHotkeys";
import { AnimationTimeline } from "./components/AnimationTimeline";
import { ContextMenu } from "./components/ContextMenu";
import { ExportPanel } from "./components/ExportPanel";
import { FieldsPanel } from "./components/FieldsPanel";
import {
  CopyIcon,
  DownloadIcon,
  FileIcon,
  FrameIcon,
  InfoIcon,
  PlusIcon,
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

const APP_LOGO_SRC = "/assets/icons/logo.svg";

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
const RIGHT_PANEL_WIDTH_KEY = "3forge-right-panel-width";
const TIMELINE_HEIGHT_KEY = "3forge-timeline-height";
const TIMELINE_VISIBLE_KEY = "3forge-timeline-visible";

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

function readAutosaveEnabledPreference(): boolean {
  if (!canUseLocalStorage()) {
    return true;
  }

  return window.localStorage.getItem(AUTOSAVE_ENABLED_KEY) !== "false";
}

function readStoredNumberPreference(key: string, fallback: number): number {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (!raw) {
    return fallback;
  }

  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readStoredBooleanPreference(key: string, fallback: boolean): boolean {
  if (!canUseLocalStorage()) {
    return fallback;
  }

  const raw = window.localStorage.getItem(key);
  if (raw === null) {
    return fallback;
  }

  return raw === "true";
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

function LandingPage({ onStartNew, onLoadProject }: { onStartNew: () => void; onLoadProject: () => void }) {
  return (
    <div className="landing-page">
      <div className="landing-page__content">
        <div className="landing-page__logo">
          <img src={APP_LOGO_SRC} alt="3Forge" className="landing-page__logo-image" />
        </div>
        <h1 className="landing-page__title">3Forge Editor</h1>
        <p className="landing-page__subtitle">
          Design, prototype, and export high-performance 3D components for your applications.
        </p>
        
        <div className="landing-page__actions">
          <button type="button" className="landing-btn landing-btn--primary" onClick={onStartNew}>
            <PlusIcon width={20} height={20} />
            <div className="landing-btn__text">
              <span className="landing-btn__label">New Project</span>
              <span className="landing-btn__desc">Start from a clean slate</span>
            </div>
          </button>
          
          <button type="button" className="landing-btn landing-btn--secondary" onClick={onLoadProject}>
            <DownloadIcon width={20} height={20} />
            <div className="landing-btn__text">
              <span className="landing-btn__label">Load Project</span>
              <span className="landing-btn__desc">Import a .json blueprint</span>
            </div>
          </button>
        </div>
        
        <div className="landing-page__footer">
          Developed for modern 3D workflows. All assets are stored locally.
        </div>
      </div>
    </div>
  );
}

export function App() {
  const [bootState] = useState(getAutosaveBootState);
  const [store] = useState(() => new EditorStore(bootState.initialBlueprint));
  const [autosaveEnabled, setAutosaveEnabled] = useState(bootState.autosaveEnabled);
  const [hasAutosave, setHasAutosave] = useState(bootState.hasAutosave);
  const [isStarted, setIsStarted] = useState(bootState.hasAutosave);
  const storeView = useEditorStoreSnapshot(store);
  const [exportMode, setExportMode] = useState<ExportMode>("typescript");
  const [rightPanelTab, setRightPanelTab] = useState<RightPanelTab>("inspector");
  const [currentTool, setCurrentTool] = useState<ToolMode>("select");
  const [currentFrame, setCurrentFrame] = useState(0);
  const [isAnimationPlaying, setIsAnimationPlaying] = useState(false);
  const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [statusText, setStatusText] = useState("Ready");
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [statusTick, setStatusTick] = useState(0);
  const [hierarchyHeight, setHierarchyHeight] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(() => readStoredNumberPreference(RIGHT_PANEL_WIDTH_KEY, 420));
  const [timelineHeight, setTimelineHeight] = useState(() => readStoredNumberPreference(TIMELINE_HEIGHT_KEY, 300));
  const [isTimelineVisible, setIsTimelineVisible] = useState(() => readStoredBooleanPreference(TIMELINE_VISIBLE_KEY, true));
  const [resizeMode, setResizeMode] = useState<"hierarchy" | "sidebar" | "timeline" | null>(null);
  const [isCompactLayout, setIsCompactLayout] = useState(() => typeof window !== "undefined" && window.innerWidth <= 840);

  const sceneRef = useRef<SceneEditor | null>(null);
  const clipboardRef = useRef<NodeClipboard | null>(null);
  const pendingImageImportRef = useRef<PendingImageImport | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const animationFrameUnsubscribeRef = useRef<(() => void) | null>(null);
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
    if (!canUseLocalStorage()) {
      return;
    }

    window.localStorage.setItem(RIGHT_PANEL_WIDTH_KEY, String(rightPanelWidth));
  }, [rightPanelWidth]);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }

    window.localStorage.setItem(TIMELINE_HEIGHT_KEY, String(timelineHeight));
  }, [timelineHeight]);

  useEffect(() => {
    if (!canUseLocalStorage()) {
      return;
    }

    window.localStorage.setItem(TIMELINE_VISIBLE_KEY, isTimelineVisible ? "true" : "false");
  }, [isTimelineVisible]);

  useEffect(() => {
    const updateLayoutMode = () => {
      setIsCompactLayout(window.innerWidth <= 840);
    };

    updateLayoutMode();
    window.addEventListener("resize", updateLayoutMode);
    return () => window.removeEventListener("resize", updateLayoutMode);
  }, []);

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
      animationFrameUnsubscribeRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (currentFrame > storeView.animation.durationFrames) {
      setCurrentFrame(storeView.animation.durationFrames);
      sceneRef.current?.seekAnimation(storeView.animation.durationFrames);
    }
  }, [currentFrame, storeView.animation.durationFrames]);

  useEffect(() => {
    if (selectedTrackId && !storeView.animation.tracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(null);
      setSelectedKeyframeId(null);
    }
  }, [selectedTrackId, storeView.animation.tracks]);

  useEffect(() => {
    if (!selectedTrackId) {
      return;
    }

    const track = storeView.animation.tracks.find((entry) => entry.id === selectedTrackId);
    if (!track || !selectedNode || track.nodeId !== selectedNode.id) {
      setSelectedTrackId(null);
      setSelectedKeyframeId(null);
    }
  }, [selectedNode, selectedTrackId, storeView.animation.tracks]);

  useEffect(() => {
    if (!selectedTrackId || !selectedKeyframeId) {
      return;
    }

    const track = storeView.animation.tracks.find((entry) => entry.id === selectedTrackId);
    if (!track || !track.keyframes.some((entry) => entry.id === selectedKeyframeId)) {
      setSelectedKeyframeId(null);
    }
  }, [selectedKeyframeId, selectedTrackId, storeView.animation.tracks]);

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

  const handleAnimationFrameChange = useCallback((frame: number) => {
    setCurrentFrame(Math.max(0, Math.min(frame, store.animation.durationFrames)));
  }, [store.animation.durationFrames]);

  const handleTimelineFrameChange = useCallback((frame: number) => {
    const nextFrame = Math.max(0, Math.min(Math.round(frame), store.animation.durationFrames));
    setCurrentFrame(nextFrame);
    setIsAnimationPlaying(false);
    sceneRef.current?.seekAnimation(nextFrame);
  }, [store.animation.durationFrames]);

  const handleAnimationPlayToggle = useCallback(() => {
    if (isAnimationPlaying) {
      sceneRef.current?.pauseAnimation();
      setIsAnimationPlaying(false);
      setTransientStatus("Animation paused.");
      return;
    }

    sceneRef.current?.playAnimation();
    setIsAnimationPlaying(true);
    setTransientStatus("Animation playing.");
  }, [isAnimationPlaying, setTransientStatus]);

  const handleAnimationStop = useCallback(() => {
    sceneRef.current?.stopAnimation();
    setCurrentFrame(0);
    setIsAnimationPlaying(false);
    setTransientStatus("Animation stopped.");
  }, [setTransientStatus]);

  const handleAddAnimationTrack = useCallback((property: AnimationPropertyPath) => {
    if (!selectedNode) {
      return;
    }

    const trackId = store.ensureAnimationTrack(selectedNode.id, property);
    if (!trackId) {
      return;
    }

    setSelectedTrackId(trackId);
    setSelectedKeyframeId(null);
    setTransientStatus(`Added ${property} track to "${selectedNode.name}".`);
  }, [selectedNode, setTransientStatus, store]);

  const handleAddAnimationKeyframe = useCallback((trackId: string) => {
    const track = store.getAnimationTrack(trackId);
    const sceneValue = track
      ? sceneRef.current?.getNodeAnimationValue(track.nodeId, track.property)
      : null;
    const keyframeId = store.addAnimationKeyframe(
      trackId,
      currentFrame,
      typeof sceneValue === "number" ? sceneValue : undefined,
    );
    if (!keyframeId) {
      return;
    }

    setSelectedTrackId(trackId);
    setSelectedKeyframeId(keyframeId);
    sceneRef.current?.seekAnimation(currentFrame);
    setTransientStatus(`Added keyframe at ${currentFrame}f.`);
  }, [currentFrame, setTransientStatus, store]);

  const handleUpdateAnimationKeyframe = useCallback((
    trackId: string,
    keyframeId: string,
    patch: Partial<Pick<AnimationKeyframe, "frame" | "value" | "ease">>,
  ) => {
    store.updateAnimationKeyframe(trackId, keyframeId, patch);
    const nextFrame = typeof patch.frame === "number" ? patch.frame : currentFrame;
    setCurrentFrame(Math.max(0, Math.min(Math.round(nextFrame), store.animation.durationFrames)));
    sceneRef.current?.seekAnimation(typeof patch.frame === "number" ? patch.frame : currentFrame);
  }, [currentFrame, store]);

  const handleRemoveAnimationKeyframe = useCallback((trackId: string, keyframeId: string) => {
    store.removeAnimationKeyframe(trackId, keyframeId);
    setSelectedKeyframeId(null);
    sceneRef.current?.seekAnimation(currentFrame);
    setTransientStatus("Keyframe removed.");
  }, [currentFrame, setTransientStatus, store]);

  const handleRemoveAnimationTrack = useCallback((trackId: string) => {
    store.removeAnimationTrack(trackId);
    if (selectedTrackId === trackId) {
      setSelectedTrackId(null);
      setSelectedKeyframeId(null);
    }
    setTransientStatus("Track removed.");
  }, [selectedTrackId, setTransientStatus, store]);

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

  const handleDeleteSelection = useCallback(() => {
    if (selectedTrackId && selectedKeyframeId) {
      handleRemoveAnimationKeyframe(selectedTrackId, selectedKeyframeId);
      return;
    }

    handleDelete();
  }, [handleDelete, handleRemoveAnimationKeyframe, selectedKeyframeId, selectedTrackId]);

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
      { id: "add-circle", label: "Circle", icon: <MeshIcon {...iconSize} />, onSelect: createNodeAction("circle") },
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

  const startHierarchyResizing = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    setResizeMode("hierarchy");
  }, []);

  const startSidebarResizing = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    setResizeMode("sidebar");
  }, []);

  const startTimelineResizing = useCallback((event: ReactPointerEvent) => {
    event.preventDefault();
    setResizeMode("timeline");
  }, []);

  useEffect(() => {
    if (!resizeMode) return;

    const handlePointerMove = (event: PointerEvent) => {
      if (resizeMode === "hierarchy") {
        const panel = document.querySelector(".panel--split");
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        const newHeight = event.clientY - rect.top;
        setHierarchyHeight(Math.max(120, Math.min(newHeight, rect.height - 120)));
        return;
      }

      if (resizeMode === "sidebar") {
        const workspace = document.querySelector(".workspace-shell");
        if (!workspace) return;

        const rect = workspace.getBoundingClientRect();
        const newWidth = rect.right - event.clientX;
        setRightPanelWidth(Math.max(280, Math.min(newWidth, 620)));
        return;
      }

      const shell = document.querySelector(".app-shell");
      if (!shell) return;

      const rect = shell.getBoundingClientRect();
      const newHeight = rect.bottom - 28 - event.clientY;
      setTimelineHeight(Math.max(190, Math.min(newHeight, 520)));
    };

    const handlePointerUp = () => {
      setResizeMode(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [resizeMode]);

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
    onDelete: handleDeleteSelection,
    onFrame: handleFrameSelection,
    onPlayPause: handleAnimationPlayToggle,
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
        { id: "edit-delete", label: "Delete", icon: <TrashIcon width={14} height={14} />, shortcut: "Delete", danger: true, disabled: (!selectedTrackId || !selectedKeyframeId) && (!selectedNode || selectedNode.id === ROOT_NODE_ID), onSelect: handleDeleteSelection },
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

  if (!isStarted) {
    return (
      <div className="app-shell app-shell--landing">
        <LandingPage 
          onStartNew={() => {
            handleNewBlueprint();
            setIsStarted(true);
          }} 
          onLoadProject={() => {
            jsonInputRef.current?.click();
          }} 
        />
        <input
          ref={jsonInputRef}
          className="hidden-input"
          type="file"
          accept=".json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            try {
              await importJsonFromFile(file);
              setIsStarted(true);
            } catch {
              setTransientStatus("Unable to import JSON.");
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      className="app-shell"
      data-status-tick={statusTick}
      style={{
        gridTemplateRows: `32px 54px minmax(0, 1fr) ${isTimelineVisible ? "8px" : "0px"} ${isTimelineVisible ? `${timelineHeight}px` : "0px"} 28px`,
      }}
    >
      <MenuBar menus={menus} />

      <SecondaryToolbar
        componentName={storeView.blueprintComponentName}
        selectedLabel={selectedNode ? `${selectedNode.name} | ${selectedNode.type === "group" ? "Group" : "Mesh"}` : "No selection"}
        nodeCount={storeView.blueprintNodes.length}
        canUndo={storeView.canUndo}
        canRedo={storeView.canRedo}
        currentTool={currentTool}
        viewMode={storeView.viewMode}
        onComponentNameChange={(value) => store.updateComponentName(value)}
        onUndo={() => { if (store.undo()) setTransientStatus("Undo."); }}
        onRedo={() => { if (store.redo()) setTransientStatus("Redo."); }}
        onToolChange={handleToolChange}
        onViewModeChange={(mode) => store.setViewMode(mode)}
        onFrame={handleFrameSelection}
        isTimelineVisible={isTimelineVisible}
        onToggleTimeline={() => setIsTimelineVisible((value) => !value)}
      />

      <div
        className="workspace-shell"
        style={{ gridTemplateColumns: isCompactLayout ? "1fr" : `minmax(0, 1fr) 8px ${rightPanelWidth}px` }}
      >
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
                animationFrameUnsubscribeRef.current?.();
                sceneRef.current = scene;
                scene?.setTransformMode(currentTool);
                if (scene) {
                  scene.seekAnimation(currentFrame);
                  animationFrameUnsubscribeRef.current = scene.onAnimationFrameChange(handleAnimationFrameChange);
                } else {
                  animationFrameUnsubscribeRef.current = null;
                }
              }}
              onContextMenu={openViewportContextMenu}
            />
          </div>
        </main>

        {!isCompactLayout ? (
          <div
            className={`panel-splitter panel-splitter--vertical${resizeMode === "sidebar" ? " is-active" : ""}`}
            onPointerDown={startSidebarResizing}
          />
        ) : null}

        <aside className="panel panel--right panel--split" style={{ gridTemplateRows: `${hierarchyHeight}px auto 1fr` }}>
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
                onToggleVisibility={(nodeId) => store.toggleNodeVisibility(nodeId)}
                onContextMenu={openSceneGraphContextMenu}
              />
            </div>
          </section>

          <div
            className={`panel-splitter panel-splitter--horizontal${resizeMode === "hierarchy" ? " is-active" : ""}`}
            onPointerDown={startHierarchyResizing}
          />

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

      {isTimelineVisible ? (
        <>
          <div
            className={`panel-splitter panel-splitter--horizontal panel-splitter--timeline${resizeMode === "timeline" ? " is-active" : ""}`}
            onPointerDown={startTimelineResizing}
          />
          <AnimationTimeline
            animation={storeView.animation}
            nodes={storeView.blueprintNodes}
            selectedNode={selectedNode}
            currentFrame={currentFrame}
            isPlaying={isAnimationPlaying}
            selectedTrackId={selectedTrackId}
            selectedKeyframeId={selectedKeyframeId}
            onPlayToggle={handleAnimationPlayToggle}
            onStop={handleAnimationStop}
            onFrameChange={handleTimelineFrameChange}
            onAnimationConfigChange={(patch) => store.updateAnimationConfig(patch)}
            onAddTrack={handleAddAnimationTrack}
            onRemoveTrack={handleRemoveAnimationTrack}
            onAddKeyframe={handleAddAnimationKeyframe}
            onSelectTrack={(trackId) => setSelectedTrackId(trackId)}
            onSelectKeyframe={(trackId, keyframeId) => {
              setSelectedTrackId(trackId);
              setSelectedKeyframeId(keyframeId);
            }}
            onUpdateKeyframe={handleUpdateAnimationKeyframe}
            onRemoveKeyframe={handleRemoveAnimationKeyframe}
            onBeginKeyframeDrag={() => store.beginHistoryTransaction()}
            onEndKeyframeDrag={() => {
              store.commitHistoryTransaction("ui");
              sceneRef.current?.seekAnimation(currentFrame);
            }}
          />
        </>
      ) : null}

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
