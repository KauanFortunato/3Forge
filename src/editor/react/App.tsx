import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { exportBlueprintToJson, generateTypeScriptComponent } from "../exports";
import { createExportPackageZip } from "../exportPackage";
import {
  BrowserFileSystemFileHandle,
  getBlueprintFileName,
  openBlueprintWithPicker,
  readBlueprintFromFile,
  saveBlueprintAs,
  saveBlueprintToExistingHandle,
  supportsFileSystemAccess,
} from "../fileAccess";
import { fontFileToAsset } from "../fonts";
import { imageFileToAsset } from "../images";
import { readRecentFileHandle, removeRecentFileHandle, saveRecentFileHandle } from "../recentFileHandles";
import { SceneEditor } from "../scene";
import { writeTextToClipboard } from "../clipboard";
import {
  createDefaultBlueprint,
  EditorStore,
  ROOT_NODE_ID,
  getPropertyDefinitions,
} from "../state";
import type { AnimationKeyframe, AnimationPropertyPath, EditorNode, EditorNodeType, GroupPivotPreset, ImageAsset } from "../types";
import type { ComponentBlueprint } from "../types";
import type { PropertyApplyReport, PropertyClipboardScope } from "../propertyClipboard";
import {
  buildRecentProjectLabel,
  clearWorkspaceSessionActive,
  createRecentProjectEntry,
  createRecentProjectId,
  createWorkspaceFromBootState,
  createWorkspaceProjectContext,
  markWorkspaceSessionActive,
  persistRecentSnapshot,
  persistWorkspace,
  readRecentSnapshot,
  readWorkspaceBootState,
  removeRecentProject,
  upsertRecentProject,
} from "../workspace";
import type { PersistedWorkspaceRecord, RecentProjectEntry, WorkspaceProjectContext } from "../workspace";
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
import { PhonePlaybackBar, PhoneViewerHeader } from "./components/PhoneViewerChrome";
import { SceneGraphPanel } from "./components/SceneGraphPanel";
import { SecondaryToolbar } from "./components/SecondaryToolbar";
import { ShortcutDialog } from "./components/ShortcutDialog";
import { ViewportHost } from "./components/ViewportHost";

const APP_VERSION = "v0.1.0";

interface NodeClipboard {
  sourceNodeIds: string[];
  subtrees: EditorNode[][];
}

type PendingImageImport =
  | { mode: "create"; parentId: string; index?: number }
  | { mode: "replace"; nodeId: string };

interface InsertTarget {
  parentId: string;
  index?: number;
}

const RIGHT_PANEL_WIDTH_KEY = "3forge-right-panel-width";
const TIMELINE_HEIGHT_KEY = "3forge-timeline-height";
const TIMELINE_VISIBLE_KEY = "3forge-timeline-visible";
const PHONE_LAYOUT_MAX_WIDTH = 720;
const TABLET_LAYOUT_MAX_WIDTH = 1080;

type LayoutMode = "phone" | "tablet" | "desktop";

function canUseLocalStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
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

function downloadTextFile(content: string, fileName: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlobFile(blob, fileName);
}

function downloadBlobFile(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function formatRecentProjectTime(timestamp: number): string {
  try {
    return new Date(timestamp).toLocaleString();
  } catch {
    return "Recently updated";
  }
}

function getProjectSourceLabel(source: WorkspaceProjectContext["source"], canOverwriteFile: boolean): string {
  if (source === "file-handle" && canOverwriteFile) {
    return "Linked file";
  }

  if (source === "imported-file") {
    return "Imported copy";
  }

  return "Local workspace";
}

function resolveLayoutMode(width: number): LayoutMode {
  if (width <= PHONE_LAYOUT_MAX_WIDTH) {
    return "phone";
  }

  if (width <= TABLET_LAYOUT_MAX_WIDTH) {
    return "tablet";
  }

  return "desktop";
}

interface LandingPageProps {
  layoutMode: LayoutMode;
  persistedWorkspace: PersistedWorkspaceRecord | null;
  recentProjects: RecentProjectEntry[];
  onContinue: () => void;
  onStartNew: () => void;
  onOpenFile: () => void;
  onOpenRecent: (recentProjectId: string) => void;
  onRemoveRecent: (recentProjectId: string) => void;
}

function LandingPage({
  layoutMode,
  persistedWorkspace,
  recentProjects,
  onContinue,
  onStartNew,
  onOpenFile,
  onOpenRecent,
  onRemoveRecent,
}: LandingPageProps) {
  const localProjectLabel = persistedWorkspace?.context.fileName
    ?? persistedWorkspace?.blueprint.componentName
    ?? "Last session";
  const isPhoneLayout = layoutMode === "phone";
  const isTabletLayout = layoutMode === "tablet";
  const localProjectSourceLabel = persistedWorkspace
    ? getProjectSourceLabel(persistedWorkspace.context.source, persistedWorkspace.context.canOverwriteFile)
    : null;

  const heroTitle = isPhoneLayout ? "3Forge" : "3Forge Editor";
  const heroSubtitle = isPhoneLayout
    ? "Phone mode is focused on loading projects and playing timelines. Use tablet or desktop for full editing."
    : isTabletLayout
      ? "Resume quickly, open files and keep editing in a compact workspace."
      : "Design, prototype, and export high-performance 3D components for your applications.";

  return (
    <div className={`landing-overlay landing-overlay--${layoutMode}`}>
      <section className="landing-hero">
        <div className="landing-hero__grid" aria-hidden="true" />
        <div className="landing-hero__brand">
          <div className="landing-hero__brand-mark" aria-hidden="true">3F</div>
          <span>3Forge</span>
        </div>
        <div className="landing-hero__body">
          <p className="landing-hero__eyebrow">Open workspace</p>
          <h1 className="landing-hero__title">{heroTitle}</h1>
          <p className="landing-hero__sub">{heroSubtitle}</p>
          <ul className="landing-hero__feats">
            <li>Inspector & runtime fields</li>
            <li>Keyframed dope-sheet</li>
            <li>TypeScript & JSON export</li>
            <li>ZIP packaging</li>
          </ul>
        </div>
      </section>

      <aside className="landing-side">
        <div className="landing-side__section">
          <div className="landing-side__hd">
            <span>Começar</span>
          </div>

          {persistedWorkspace ? (
            <button type="button" className="landing-action is-primary" onClick={onContinue}>
              <span className="landing-action__ico"><FrameIcon width={14} height={14} /></span>
              <span className="landing-action__body">
                <span className="landing-action__title">Continue where you left off</span>
                <span className="landing-action__sub">{`${localProjectSourceLabel} · ${localProjectLabel}`}</span>
              </span>
            </button>
          ) : null}

          <button type="button" className="landing-action" onClick={onStartNew}>
            <span className="landing-action__ico"><PlusIcon width={14} height={14} /></span>
            <span className="landing-action__body">
              <span className="landing-action__title">New project</span>
              <span className="landing-action__sub">Start from a clean slate</span>
            </span>
          </button>

          <button type="button" className="landing-action" onClick={onOpenFile}>
            <span className="landing-action__ico"><DownloadIcon width={14} height={14} /></span>
            <span className="landing-action__body">
              <span className="landing-action__title">Open file</span>
              <span className="landing-action__sub">Load a blueprint from your machine</span>
            </span>
          </button>
        </div>

        <section className="landing-side__section">
          <div className="landing-side__hd">
            <span>{isPhoneLayout ? "Recent projects" : "Open recent"}</span>
          </div>

          {recentProjects.length > 0 ? (
            <div>
              {recentProjects.map((entry) => (
                <div key={entry.id} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <button
                    type="button"
                    className="landing-recent"
                    onClick={() => onOpenRecent(entry.id)}
                  >
                    <span>
                      <span className="landing-recent__name">{entry.label}</span>
                      <span className="landing-recent__meta">
                        <span>{entry.source === "file-handle" ? "Linked file" : "Local snapshot"}</span>
                        <span>·</span>
                        <span>{entry.componentName}</span>
                      </span>
                    </span>
                    <span className="landing-recent__time">{formatRecentProjectTime(entry.updatedAt)}</span>
                  </button>
                  <button
                    type="button"
                    className="landing-recent__remove"
                    aria-label={`Remove ${entry.label} from recents`}
                    onClick={() => onRemoveRecent(entry.id)}
                  >
                    <span aria-hidden="true">x</span>
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="landing-empty">
              Projects you opened or imported recently appear here and can be reopened later.
            </div>
          )}
        </section>

        <div className="landing-side__footer">
          {isPhoneLayout
            ? "Reload keeps your current session. Leaving the app returns here without deleting local work."
            : "Reload keeps your current session in place. Reopening the app brings you back to this launcher without deleting local work."}
        </div>
      </aside>
    </div>
  );
}

export function App() {
  const [bootState] = useState(readWorkspaceBootState);
  const [initialWorkspace] = useState(() => {
    const workspace = createWorkspaceFromBootState(bootState);
    if (!workspace.context.recentProjectId) {
      workspace.context = createWorkspaceProjectContext({
        ...workspace.context,
        recentProjectId: createRecentProjectId(),
      });
    }
    return workspace;
  });
  const [store] = useState(() => new EditorStore(initialWorkspace.blueprint));
  const [projectContext, setProjectContext] = useState<WorkspaceProjectContext>(initialWorkspace.context);
  const [recentProjects, setRecentProjects] = useState(bootState.recentProjects);
  const [persistedWorkspace, setPersistedWorkspace] = useState<PersistedWorkspaceRecord | null>(bootState.persistedWorkspace);
  const [isStarted, setIsStarted] = useState(bootState.shouldOpenEditor);
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
  const [toast, setToast] = useState<{ message: string; tone: "info" | "warning" } | null>(null);
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
  const [collapsedHierarchyIds, setCollapsedHierarchyIds] = useState<Set<string>>(() => new Set());
  const [statusTick, setStatusTick] = useState(0);
  const [hierarchyHeight, setHierarchyHeight] = useState(320);
  const [rightPanelWidth, setRightPanelWidth] = useState(() => readStoredNumberPreference(RIGHT_PANEL_WIDTH_KEY, 420));
  const [timelineHeight, setTimelineHeight] = useState(() => readStoredNumberPreference(TIMELINE_HEIGHT_KEY, 300));
  const [isTimelineVisible, setIsTimelineVisible] = useState(() => readStoredBooleanPreference(TIMELINE_VISIBLE_KEY, true));
  const [resizeMode, setResizeMode] = useState<"hierarchy" | "sidebar" | "timeline" | null>(null);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(() => (
    typeof window === "undefined" ? "desktop" : resolveLayoutMode(window.innerWidth)
  ));

  const sceneRef = useRef<SceneEditor | null>(null);
  const clipboardRef = useRef<NodeClipboard | null>(null);
  const pendingImageImportRef = useRef<PendingImageImport | null>(null);
  const statusTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const animationFrameUnsubscribeRef = useRef<(() => void) | null>(null);
  const activeFileHandleRef = useRef<BrowserFileSystemFileHandle | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const fontInputRef = useRef<HTMLInputElement | null>(null);

  const blueprintSnapshot = useMemo(() => store.getSnapshot(), [store, storeView]);
  const blueprintJson = useMemo(() => exportBlueprintToJson(blueprintSnapshot), [blueprintSnapshot]);
  const typeScriptExport = useMemo(() => generateTypeScriptComponent(blueprintSnapshot), [blueprintSnapshot]);
  const exportPreview = exportMode === "json" ? blueprintJson : typeScriptExport;
  const isPhoneLayout = layoutMode === "phone";
  const isCompactLayout = layoutMode !== "desktop";
  const effectiveToolMode = isPhoneLayout ? "select" : currentTool;
  const showEditingTimeline = isTimelineVisible && !isPhoneLayout;
  const shellBodyClassName = `app__body${isPhoneLayout ? " app__body--phone" : ""}`;
  const centerColClassName = `app__col app__col--center${showEditingTimeline ? " has-timeline" : ""}`;
  const shellStyle = useMemo(
    () => ({
      "--right-w": `${rightPanelWidth}px`,
      "--tl-h": `${timelineHeight}px`,
      "--hierarchy-h": `${hierarchyHeight}px`,
    }) as CSSProperties,
    [rightPanelWidth, timelineHeight, hierarchyHeight],
  );
  const selectedNodeIds = storeView.selectedNodeIds;
  const selectedNodeIdsSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedNodeCount = selectedNodeIds.length;
  const selectedNode = storeView.selectedNode;
  const selectedNodes = storeView.selectedNodes;
  const inspectorNode = selectedNodeCount > 1 ? undefined : selectedNode;
  const selectedRootIds = useMemo(
    () => store.getSelectionRootIds(selectedNodeIds),
    [selectedNodeIds, store, storeView.blueprintNodes],
  );
  const activeClip = useMemo(
    () => storeView.animation.clips.find((clip) => clip.id === storeView.animation.activeClipId) ?? storeView.animation.clips[0],
    [storeView.animation.activeClipId, storeView.animation.clips],
  );
  const activeClipTracks = useMemo(
    () => activeClip?.tracks ?? [],
    [activeClip],
  );
  const activeProjectLabel = projectContext.fileName ?? storeView.blueprintComponentName;
  const animatedNodeIds = useMemo(
    () => new Set(storeView.animation.clips.flatMap((clip) => clip.tracks.map((track) => track.nodeId))),
    [storeView.animation.clips],
  );
  const collapsibleHierarchyNodeIds = useMemo(
    () => storeView.blueprintNodes.filter((node) => node.type === "group").map((node) => node.id),
    [storeView.blueprintNodes],
  );
  const areAllHierarchyGroupsCollapsed = collapsibleHierarchyNodeIds.length > 0
    && collapsibleHierarchyNodeIds.every((nodeId) => collapsedHierarchyIds.has(nodeId));
  const shouldPersistWorkspace = isStarted || bootState.persistedWorkspace !== null;

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

  const showToast = useCallback((message: string, tone: "info" | "warning" = "info") => {
    setToast({ message, tone });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimerRef.current = null;
    }, 2500);
  }, []);

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
    if (!shouldPersistWorkspace) {
      return;
    }

    persistWorkspace(blueprintSnapshot, projectContext);
    setPersistedWorkspace({
      blueprint: blueprintSnapshot,
      context: {
        ...projectContext,
        updatedAt: Date.now(),
      },
    });

    if (projectContext.recentProjectId) {
      persistRecentSnapshot(projectContext.recentProjectId, blueprintSnapshot);
      const entry = createRecentProjectEntry({
        id: projectContext.recentProjectId,
        label: buildRecentProjectLabel(projectContext.fileName, blueprintSnapshot.componentName),
        componentName: blueprintSnapshot.componentName,
        source: projectContext.fileHandleId ? "file-handle" : "snapshot",
        fileName: projectContext.fileName,
        fileHandleId: projectContext.fileHandleId,
      });
      setRecentProjects(upsertRecentProject(entry));
    }
  }, [blueprintSnapshot, projectContext, shouldPersistWorkspace]);

  useEffect(() => {
    if (isStarted) {
      markWorkspaceSessionActive();
      return;
    }

    clearWorkspaceSessionActive();
  }, [isStarted]);

  useEffect(() => {
    const updateLayoutMode = () => {
      setLayoutMode(resolveLayoutMode(window.innerWidth));
    };

    updateLayoutMode();
    window.addEventListener("resize", updateLayoutMode);
    return () => window.removeEventListener("resize", updateLayoutMode);
  }, []);

  useEffect(() => {
    sceneRef.current?.setTransformMode(effectiveToolMode);
  }, [effectiveToolMode]);

  useEffect(() => {
    return () => {
      if (statusTimerRef.current) {
        window.clearTimeout(statusTimerRef.current);
      }
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
      animationFrameUnsubscribeRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (activeClip && currentFrame > activeClip.durationFrames) {
      setCurrentFrame(activeClip.durationFrames);
      sceneRef.current?.seekAnimation(activeClip.durationFrames);
    }
  }, [activeClip, currentFrame]);

  useEffect(() => {
    if (selectedTrackId && !activeClipTracks.some((track) => track.id === selectedTrackId)) {
      setSelectedTrackId(null);
      setSelectedKeyframeId(null);
    }
  }, [activeClipTracks, selectedTrackId]);

  useEffect(() => {
    if (!selectedTrackId) {
      return;
    }

    const track = activeClipTracks.find((entry) => entry.id === selectedTrackId);
    if (!track || !selectedNode || track.nodeId !== selectedNode.id) {
      setSelectedTrackId(null);
      setSelectedKeyframeId(null);
    }
  }, [activeClipTracks, selectedNode, selectedTrackId]);

  useEffect(() => {
    if (!selectedTrackId || !selectedKeyframeId) {
      return;
    }

    const track = activeClipTracks.find((entry) => entry.id === selectedTrackId);
    if (!track || !track.keyframes.some((entry) => entry.id === selectedKeyframeId)) {
      setSelectedKeyframeId(null);
    }
  }, [activeClipTracks, selectedKeyframeId, selectedTrackId]);

  const getSiblingIndex = useCallback((nodeId: string) => {
    const node = store.getNode(nodeId);
    if (!node) {
      return 0;
    }

    return store.getNodeChildren(node.parentId).findIndex((entry) => entry.id === nodeId);
  }, [store]);

  const collectSubtreeNodes = useCallback((rootNodeId: string) => store.getSubtreeNodes(rootNodeId), [store]);

  const resolveContextSelectionRootIds = useCallback((nodeId?: string | null) => {
    if (nodeId && !selectedNodeIdsSet.has(nodeId)) {
      return store.getSelectionRootIds([nodeId]);
    }

    return selectedRootIds;
  }, [selectedNodeIdsSet, selectedRootIds, store]);

  const canGroupNodeIds = useCallback((nodeIds: string[]) => {
    if (nodeIds.length < 2) {
      return false;
    }

    const parentId = store.getNode(nodeIds[0])?.parentId ?? ROOT_NODE_ID;
    return nodeIds.every((nodeId) => store.getNode(nodeId)?.parentId === parentId);
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

  const handleApplyGroupPivotPreset = useCallback((nodeId: string, preset: GroupPivotPreset) => {
    const node = store.getNode(nodeId);
    if (!node || node.type !== "group") {
      return;
    }

    const changed = store.setGroupPivotFromPreset(nodeId, preset);
    if (!changed) {
      setTransientStatus(`Pivot for "${node.name}" is already up to date.`);
      return;
    }

    setTransientStatus(`Updated pivot for "${node.name}" from current content bounds.`);
  }, [setTransientStatus, store]);

  const handleAnimationFrameChange = useCallback((frame: number) => {
    const durationFrames = store.getActiveAnimationClip()?.durationFrames ?? 0;
    setCurrentFrame(Math.max(0, Math.min(frame, durationFrames)));
  }, [store]);

  const handleTimelineFrameChange = useCallback((frame: number) => {
    const nextFrame = Math.max(0, Math.min(Math.round(frame), store.getActiveAnimationClip()?.durationFrames ?? 0));
    setCurrentFrame(nextFrame);
    setIsAnimationPlaying(false);
    sceneRef.current?.seekAnimation(nextFrame);
  }, [store]);

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

  const handleAnimationSkipBack = useCallback(() => {
    sceneRef.current?.seekAnimation(0);
    setCurrentFrame(0);
  }, []);

  const handleAnimationSkipForward = useCallback(() => {
    const endFrame = store.getActiveAnimationClip()?.durationFrames ?? 0;
    sceneRef.current?.seekAnimation(endFrame);
    setCurrentFrame(endFrame);
  }, [store]);

  const handleAnimationRewind = useCallback(() => {
    setCurrentFrame((previous) => {
      const next = Math.max(0, previous - 10);
      sceneRef.current?.seekAnimation(next);
      return next;
    });
  }, []);

  const handleAnimationFastForward = useCallback(() => {
    const endFrame = store.getActiveAnimationClip()?.durationFrames ?? 0;
    setCurrentFrame((previous) => {
      const next = Math.min(endFrame, previous + 10);
      sceneRef.current?.seekAnimation(next);
      return next;
    });
  }, [store]);

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
    setCurrentFrame(Math.max(0, Math.min(Math.round(nextFrame), store.getActiveAnimationClip()?.durationFrames ?? 0)));
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

  const handleSelectAnimationTrack = useCallback((trackId: string | null) => {
    setSelectedTrackId(trackId);
    if (!trackId) {
      setSelectedKeyframeId(null);
      return;
    }

    const track = activeClipTracks.find((entry) => entry.id === trackId) ?? store.getAnimationTrack(trackId);
    if (track && selectedNode?.id !== track.nodeId) {
      store.selectNode(track.nodeId);
    }
  }, [activeClipTracks, selectedNode?.id, store]);

  const handleSelectAnimationKeyframe = useCallback((trackId: string, keyframeId: string | null) => {
    handleSelectAnimationTrack(trackId);
    setSelectedKeyframeId(keyframeId);
  }, [handleSelectAnimationTrack]);

  const handleCreateAnimationClip = useCallback(() => {
    const clipId = store.createAnimationClip();
    setSelectedTrackId(null);
    setSelectedKeyframeId(null);
    setCurrentFrame(0);
    sceneRef.current?.seekAnimation(0);
    setTransientStatus(`Created clip "${store.getAnimationClip(clipId)?.name ?? "clip"}".`);
  }, [setTransientStatus, store]);

  const handleSelectAnimationClip = useCallback((clipId: string) => {
    store.setActiveAnimationClip(clipId);
    setSelectedTrackId(null);
    setSelectedKeyframeId(null);
    setCurrentFrame(0);
    sceneRef.current?.seekAnimation(0);
  }, [store]);

  const handleRenameAnimationClip = useCallback((clipId: string, name: string) => {
    store.renameAnimationClip(clipId, name);
  }, [store]);

  const handleRemoveAnimationClip = useCallback((clipId: string) => {
    store.removeAnimationClip(clipId);
    setSelectedTrackId(null);
    setSelectedKeyframeId(null);
    setCurrentFrame(0);
    sceneRef.current?.seekAnimation(0);
    setTransientStatus("Clip removed.");
  }, [setTransientStatus, store]);

  const handleDuplicateAnimationClip = useCallback((clipId: string) => {
    const newClipId = store.duplicateAnimationClip(clipId);
    if (!newClipId) {
      return;
    }
    const newClip = store.getAnimationClip(newClipId);
    setTransientStatus(newClip ? `Duplicated clip "${newClip.name}".` : "Clip duplicated.");
  }, [setTransientStatus, store]);

  const handleSetAnimationTrackMuted = useCallback((clipId: string, trackId: string, muted: boolean) => {
    store.setTrackMuted(clipId, trackId, muted);
    sceneRef.current?.seekAnimation(currentFrame);
  }, [currentFrame, store]);

  const handleRemoveAnimationKeyframes = useCallback((trackId: string, keyframeIds: string[]) => {
    if (keyframeIds.length === 0) {
      return;
    }
    store.removeAnimationKeyframes(trackId, keyframeIds);
    setSelectedKeyframeId(null);
    sceneRef.current?.seekAnimation(currentFrame);
    setTransientStatus(`Removed ${keyframeIds.length} keyframes.`);
  }, [currentFrame, setTransientStatus, store]);

  const handleShiftAnimationKeyframes = useCallback((trackId: string, keyframeIds: string[], frameDelta: number) => {
    if (keyframeIds.length === 0 || frameDelta === 0) {
      return;
    }
    store.shiftAnimationKeyframes(trackId, keyframeIds, frameDelta);
    sceneRef.current?.seekAnimation(currentFrame);
  }, [currentFrame, store]);

  const handleCopy = useCallback(() => {
    const targetRootIds = selectedRootIds.filter((nodeId) => nodeId !== ROOT_NODE_ID);
    if (targetRootIds.length === 0) {
      return;
    }

    clipboardRef.current = {
      sourceNodeIds: targetRootIds,
      subtrees: targetRootIds.map((nodeId) => collectSubtreeNodes(nodeId)),
    };
    if (targetRootIds.length === 1) {
      const copiedNode = store.getNode(targetRootIds[0]);
      setTransientStatus(copiedNode ? `Copied "${copiedNode.name}".` : "Copied selection.");
      return;
    }

    setTransientStatus(`Copied ${targetRootIds.length} objects.`);
  }, [collectSubtreeNodes, selectedRootIds, setTransientStatus, store]);

  const handlePaste = useCallback((targetNodeId?: string | null) => {
    const clipboard = clipboardRef.current;
    if (!clipboard) {
      return;
    }

    const target = targetNodeId
      ? resolveContextInsertTarget(targetNodeId)
      : resolveSelectionInsertTarget();
    const newRootIds = store.pasteNodeSubtrees(clipboard.subtrees, target.parentId, target.index);
    if (newRootIds.length === 0) {
      return;
    }

    if (newRootIds.length === 1) {
      const pasted = store.getNode(newRootIds[0]);
      setTransientStatus(pasted ? `Pasted "${pasted.name}".` : "Pasted selection.");
      return;
    }

    setTransientStatus(`Pasted ${newRootIds.length} objects.`);
  }, [resolveContextInsertTarget, resolveSelectionInsertTarget, setTransientStatus, store]);

  const handleCopyProperties = useCallback(() => {
    const primary = store.selectedNode;
    if (!primary || primary.id === ROOT_NODE_ID) {
      return;
    }

    const captured = store.capturePropertiesFromSelection();
    if (captured) {
      setTransientStatus(`Copied properties from "${primary.name}".`);
    }
  }, [setTransientStatus, store]);

  const formatApplyReport = useCallback((report: PropertyApplyReport) => {
    const applied = report.applied;
    const incompatible = report.skippedIncompatible;

    if (applied > 0 && incompatible === 0) {
      return { message: `${applied} properties applied`, tone: "info" as const };
    }
    if (applied > 0 && incompatible > 0) {
      return { message: `${applied} applied · ${incompatible} incompatible`, tone: "info" as const };
    }
    if (applied === 0 && incompatible > 0) {
      return { message: "No compatible properties", tone: "warning" as const };
    }
    return null;
  }, []);

  const handlePasteProperties = useCallback((
    scope: PropertyClipboardScope = "all",
    targetNodeIds?: string[],
  ) => {
    if (!store.propertyClipboard) {
      return;
    }

    const report = store.applyPropertiesToSelection(scope, targetNodeIds);
    const toastPayload = formatApplyReport(report);
    if (toastPayload) {
      showToast(toastPayload.message, toastPayload.tone);
    }
  }, [formatApplyReport, showToast, store]);

  const handleDelete = useCallback((nodeId?: string | null) => {
    const targetRootIds = resolveContextSelectionRootIds(nodeId ?? null);
    if (targetRootIds.length === 0 || (targetRootIds.length === 1 && targetRootIds[0] === ROOT_NODE_ID)) {
      return;
    }

    if (targetRootIds.length === 1) {
      const node = store.getNode(targetRootIds[0]);
      if (!node) {
        return;
      }

      store.deleteNode(targetRootIds[0]);
      setTransientStatus(`Deleted "${node.name}".`);
      return;
    }

    store.deleteSelected();
    setTransientStatus(`Deleted ${targetRootIds.length} objects.`);
  }, [resolveContextSelectionRootIds, selectedRootIds, setTransientStatus, store]);

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

  const handleGroupSelection = useCallback((nodeId?: string | null) => {
    const targetRootIds = resolveContextSelectionRootIds(nodeId ?? null);
    if (!canGroupNodeIds(targetRootIds)) {
      return;
    }

    const groupId = store.groupNodes(targetRootIds);
    if (!groupId) {
      return;
    }

    const groupNode = store.getNode(groupId);
    setTransientStatus(groupNode
      ? `Grouped ${targetRootIds.length} objects into "${groupNode.name}".`
      : `Grouped ${targetRootIds.length} objects.`);
  }, [canGroupNodeIds, resolveContextSelectionRootIds, setTransientStatus, store]);

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

  const syncRecentProject = useCallback(async (
    blueprint: ComponentBlueprint,
    {
      recentProjectId = createRecentProjectId(),
      fileName = projectContext.fileName,
      handle = null,
      fileHandleId: explicitFileHandleId,
    }: {
      recentProjectId?: string;
      fileName?: string | null;
      handle?: BrowserFileSystemFileHandle | null;
      fileHandleId?: string | null;
    } = {},
  ) => {
    let fileHandleId = typeof explicitFileHandleId !== "undefined"
      ? explicitFileHandleId
      : (recentProjectId === projectContext.recentProjectId ? projectContext.fileHandleId : null);

    if (handle) {
      fileHandleId ??= createRecentProjectId();
      activeFileHandleRef.current = handle;
      const handleStored = await saveRecentFileHandle(fileHandleId, handle);
      if (!handleStored) {
        fileHandleId = null;
      }
    }

    persistRecentSnapshot(recentProjectId, blueprint);
    const entry = createRecentProjectEntry({
      id: recentProjectId,
      label: buildRecentProjectLabel(fileName ?? null, blueprint.componentName),
      componentName: blueprint.componentName,
      source: fileHandleId ? "file-handle" : "snapshot",
      fileName: fileName ?? null,
      fileHandleId,
    });
    setRecentProjects(upsertRecentProject(entry));

    return {
      recentProjectId,
      fileHandleId,
    };
  }, [projectContext.fileHandleId, projectContext.fileName, projectContext.recentProjectId]);

  const applyWorkspaceBlueprint = useCallback((
    rawBlueprint: unknown,
    context: WorkspaceProjectContext,
    message: string,
  ) => {
    if (!context.fileHandleId) {
      activeFileHandleRef.current = null;
    }
    store.loadBlueprint(rawBlueprint, "ui");
    setProjectContext(context);
    setCurrentFrame(0);
    setIsAnimationPlaying(false);
    setSelectedTrackId(null);
    setSelectedKeyframeId(null);
    setIsStarted(true);
    setTransientStatus(message);
  }, [setTransientStatus, store]);

  const downloadExportFile = useCallback((mode: ExportMode) => {
    const content = mode === "json" ? blueprintJson : typeScriptExport;
    const extension = mode === "json" ? "json" : "ts";
    const fileName = `${blueprintSnapshot.componentName || "3forge-component"}.${extension}`;
    downloadTextFile(content, fileName, mode === "json" ? "application/json" : "text/plain");
    setTransientStatus(`Downloaded ${fileName}.`);
  }, [blueprintJson, blueprintSnapshot.componentName, setTransientStatus, typeScriptExport]);

  const downloadExportPackage = useCallback(async () => {
    try {
      const archive = await createExportPackageZip(blueprintSnapshot);
      downloadBlobFile(archive.blob, archive.fileName);
      setTransientStatus(`Downloaded ${archive.fileName}.`);
    } catch {
      setTransientStatus("Unable to build ZIP package.");
    }
  }, [blueprintSnapshot, setTransientStatus]);

  const copyExportText = useCallback(async () => {
    const result = await writeTextToClipboard(exportPreview);
    if (result.status === "copied") {
      setTransientStatus("Export copied.");
      return;
    }

    if (result.status === "denied") {
      setTransientStatus("Clipboard permission denied. Use download instead.");
      return;
    }

    if (result.status === "unsupported") {
      setTransientStatus("Clipboard API unavailable. Use download instead.");
      return;
    }

    setTransientStatus("Unable to copy export.");
  }, [exportPreview, setTransientStatus]);

  const importJsonFromFile = useCallback(async (file: File) => {
    const rawBlueprint = await readBlueprintFromFile(file);
    const blueprint = rawBlueprint as ComponentBlueprint;
    const { recentProjectId } = await syncRecentProject(blueprint, {
      fileName: file.name,
    });

    applyWorkspaceBlueprint(
      rawBlueprint,
      createWorkspaceProjectContext({
        source: "imported-file",
        fileName: file.name,
        recentProjectId,
        fileHandleId: null,
        canOverwriteFile: false,
      }),
      `Imported ${file.name}.`,
    );
  }, [applyWorkspaceBlueprint, syncRecentProject]);

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
    activeFileHandleRef.current = null;
    applyWorkspaceBlueprint(
      createDefaultBlueprint(),
      createWorkspaceProjectContext({
        source: "local",
        fileName: null,
        recentProjectId: createRecentProjectId(),
        fileHandleId: null,
        canOverwriteFile: false,
      }),
      "Created new project.",
    );
  }, [applyWorkspaceBlueprint]);

  const handleContinueWorkspace = useCallback(() => {
    if (!persistedWorkspace) {
      setTransientStatus("No local project available.");
      return;
    }

    applyWorkspaceBlueprint(
      persistedWorkspace.blueprint,
      persistedWorkspace.context,
      "Restored local project.",
    );
  }, [applyWorkspaceBlueprint, persistedWorkspace, setTransientStatus]);

  const handleOpenFile = useCallback(async () => {
    if (!supportsFileSystemAccess()) {
      jsonInputRef.current?.click();
      return;
    }

    try {
      const result = await openBlueprintWithPicker();
      if (!result) {
        return;
      }

      const blueprint = result.blueprint as ComponentBlueprint;
      const { recentProjectId, fileHandleId } = await syncRecentProject(blueprint, {
        fileName: result.fileName,
        handle: result.handle,
      });

      applyWorkspaceBlueprint(
        result.blueprint,
        createWorkspaceProjectContext({
          source: fileHandleId ? "file-handle" : "imported-file",
          fileName: result.fileName,
          recentProjectId,
          fileHandleId,
          canOverwriteFile: true,
        }),
        `Opened ${result.fileName}.`,
      );
    } catch {
      setTransientStatus("Unable to open file.");
    }
  }, [applyWorkspaceBlueprint, setTransientStatus, syncRecentProject]);

  const handleOpenRecent = useCallback(async (recentProjectId: string) => {
    const entry = recentProjects.find((candidate) => candidate.id === recentProjectId);
    if (!entry) {
      setTransientStatus("Recent project no longer exists.");
      return;
    }

    let handle: BrowserFileSystemFileHandle | null = null;
    let rawBlueprint: unknown | null = null;
    let openedFromSnapshot = false;

    if (entry.fileHandleId) {
      handle = activeFileHandleRef.current && projectContext.fileHandleId === entry.fileHandleId
        ? activeFileHandleRef.current
        : await readRecentFileHandle(entry.fileHandleId);
      if (handle) {
        try {
          rawBlueprint = await readBlueprintFromFile(await handle.getFile());
          activeFileHandleRef.current = handle;
        } catch {
          handle = null;
        }
      }
    }

    if (!rawBlueprint) {
      rawBlueprint = readRecentSnapshot(entry.id);
      openedFromSnapshot = true;
    }

    if (!rawBlueprint) {
      if (entry.fileHandleId) {
        await removeRecentFileHandle(entry.fileHandleId);
      }
      setRecentProjects(removeRecentProject(entry.id));
      setTransientStatus("Recent project is no longer available.");
      return;
    }

    applyWorkspaceBlueprint(
      rawBlueprint,
      createWorkspaceProjectContext({
        source: handle ? "file-handle" : "imported-file",
        fileName: entry.fileName,
        recentProjectId: entry.id,
        fileHandleId: handle ? entry.fileHandleId : null,
        canOverwriteFile: Boolean(handle),
      }),
      openedFromSnapshot
        ? `Opened recent "${entry.label}" from local snapshot.`
        : `Opened recent "${entry.label}".`,
    );
  }, [applyWorkspaceBlueprint, projectContext.fileHandleId, recentProjects, setTransientStatus]);

  const handleRemoveRecent = useCallback(async (recentProjectId: string) => {
    const entry = recentProjects.find((candidate) => candidate.id === recentProjectId);
    if (!entry) {
      return;
    }

    if (entry.fileHandleId) {
      await removeRecentFileHandle(entry.fileHandleId);
    }

    setRecentProjects(removeRecentProject(recentProjectId));
    setTransientStatus(`Removed "${entry.label}" from recents.`);
  }, [recentProjects, setTransientStatus]);

  const handleSaveAsProject = useCallback(async () => {
    const suggestedName = projectContext.fileName ?? getBlueprintFileName(blueprintSnapshot.componentName);
    const result = await saveBlueprintAs(blueprintSnapshot, suggestedName);

    if (result.status === "saved") {
      const { recentProjectId, fileHandleId } = await syncRecentProject(blueprintSnapshot, {
        fileName: result.handle.name,
        handle: result.handle,
      });
      setProjectContext(createWorkspaceProjectContext({
        source: fileHandleId ? "file-handle" : "imported-file",
        fileName: result.handle.name,
        recentProjectId,
        fileHandleId,
        canOverwriteFile: true,
      }));
      setTransientStatus(`Saved ${result.handle.name}.`);
      return;
    }

    if (result.status === "cancelled") {
      setTransientStatus("Save As cancelled.");
      return;
    }

    if (result.status === "permission-denied") {
      setTransientStatus("Write permission denied for the selected file.");
      return;
    }

    if (result.status === "unsupported") {
      const fileName = getBlueprintFileName(blueprintSnapshot.componentName);
      downloadTextFile(blueprintJson, fileName, "application/json");
      setTransientStatus(`File System Access unavailable. Downloaded ${fileName} instead.`);
      return;
    }

    setTransientStatus("Unable to save the project.");
  }, [blueprintJson, blueprintSnapshot, projectContext.fileName, setTransientStatus, syncRecentProject]);

  const handleSaveProject = useCallback(async () => {
    const linkedHandle = activeFileHandleRef.current
      ?? (projectContext.fileHandleId ? await readRecentFileHandle(projectContext.fileHandleId) : null);

    if (!linkedHandle) {
      await handleSaveAsProject();
      return;
    }

    activeFileHandleRef.current = linkedHandle;
    const result = await saveBlueprintToExistingHandle(blueprintSnapshot, linkedHandle);

    if (result.status === "saved") {
      const { recentProjectId, fileHandleId } = await syncRecentProject(blueprintSnapshot, {
        recentProjectId: projectContext.recentProjectId ?? createRecentProjectId(),
        fileName: linkedHandle.name,
        handle: linkedHandle,
      });
      setProjectContext(createWorkspaceProjectContext({
        source: fileHandleId ? "file-handle" : "imported-file",
        fileName: linkedHandle.name,
        recentProjectId,
        fileHandleId,
        canOverwriteFile: true,
      }));
      setTransientStatus(`Saved ${linkedHandle.name}.`);
      return;
    }

    if (result.status === "permission-denied") {
      setTransientStatus("Write permission denied. Falling back to Save As.");
      await handleSaveAsProject();
      return;
    }

    if (result.status === "unsupported") {
      setTransientStatus("Direct overwrite is unavailable here. Falling back to Save As.");
      await handleSaveAsProject();
      return;
    }

    setTransientStatus("Unable to overwrite the current file. Falling back to Save As.");
    await handleSaveAsProject();
  }, [blueprintSnapshot, handleSaveAsProject, projectContext.fileHandleId, projectContext.recentProjectId, setTransientStatus, syncRecentProject]);

  const handleExitProject = useCallback(() => {
    setIsStarted(false);
    setTransientStatus("Exited current project. Local snapshot kept.");
  }, [setTransientStatus]);

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
        const panel = document.querySelector(".app__col--right");
        if (!panel) return;

        const rect = panel.getBoundingClientRect();
        const newHeight = event.clientY - rect.top;
        setHierarchyHeight(Math.max(120, Math.min(newHeight, rect.height - 120)));
        return;
      }

      if (resizeMode === "sidebar") {
        const body = document.querySelector(".app__body");
        if (!body) return;

        const rect = body.getBoundingClientRect();
        const newWidth = rect.right - event.clientX;
        setRightPanelWidth(Math.max(280, Math.min(newWidth, 620)));
        return;
      }

      const centerCol = document.querySelector(".app__col--center");
      if (!centerCol) return;

      const rect = centerCol.getBoundingClientRect();
      const newHeight = rect.bottom - event.clientY;
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
    const isDraggingMultiSelection = store.selectedNodeIds.length > 1
      && store.selectedNodeIds.includes(nodeId);
    if (isDraggingMultiSelection) {
      if (store.moveSelectedNodes(target.parentId, target.index)) {
        const count = store.getSelectionRootIds().filter((id) => id !== ROOT_NODE_ID).length;
        setTransientStatus(`Moved ${count} nodes.`);
      }
      return;
    }
    if (store.moveNode(nodeId, target.parentId, target.index)) {
      const node = store.getNode(nodeId);
      setTransientStatus(node ? `Moved "${node.name}".` : "Moved node.");
    }
  }, [setTransientStatus, store]);

  const handleToggleHierarchyCollapse = useCallback(() => {
    setCollapsedHierarchyIds((current) => {
      const shouldExpandAll = collapsibleHierarchyNodeIds.length > 0
        && collapsibleHierarchyNodeIds.every((nodeId) => current.has(nodeId));
      return shouldExpandAll
        ? new Set<string>()
        : new Set(collapsibleHierarchyNodeIds);
    });
  }, [collapsibleHierarchyNodeIds]);

  const openSceneGraphContextMenu = useCallback((event: MouseEvent, nodeId: string | null) => {
    const shouldUseExistingSelection = !nodeId || selectedNodeIdsSet.has(nodeId);
    if (nodeId && !shouldUseExistingSelection) {
      store.selectNode(nodeId);
    }

    const targetNode = nodeId ? store.getNode(nodeId) : null;
    const contextRootIds = shouldUseExistingSelection
      ? selectedRootIds
      : (nodeId ? store.getSelectionRootIds([nodeId]) : []);
    const canGroupSelection = canGroupNodeIds(contextRootIds);
    const contextTargetId = contextRootIds.length === 1 ? contextRootIds[0] : nodeId;
    const propertyTargetIds = contextRootIds.filter((id) => id !== ROOT_NODE_ID);
    const primaryForCopy = contextTargetId ? store.getNode(contextTargetId) : null;
    const canCopyProperties = Boolean(primaryForCopy) && contextTargetId !== ROOT_NODE_ID;
    const hasClipboard = Boolean(store.propertyClipboard);
    const canPasteAny = hasClipboard
      && propertyTargetIds.length > 0
      && store.canPasteProperties("all", propertyTargetIds);
    const addActions = createAddMenuActions(() => resolveContextInsertTarget(nodeId));
    const items: MenuAction[] = [
      { id: "ctx-new", label: "New", icon: <MeshIcon width={14} height={14} />, children: addActions },
      { id: "ctx-paste", label: "Paste", icon: <FileIcon width={14} height={14} />, shortcut: "Ctrl+V", disabled: !clipboardRef.current, onSelect: () => handlePaste(nodeId) },
      canGroupSelection
        ? { id: "ctx-group-selection", label: "Group Selected", icon: <GroupIcon width={14} height={14} />, onSelect: () => handleGroupSelection(nodeId) }
        : { id: "ctx-group-selection", label: "Group Selected", icon: <GroupIcon width={14} height={14} />, disabled: true },
      { id: "ctx-divider-1", separator: true },
      {
        id: "ctx-copy-properties",
        label: "Copy Properties",
        icon: <CopyIcon width={14} height={14} />,
        shortcut: "Ctrl+Shift+C",
        disabled: !canCopyProperties,
        onSelect: () => {
          if (contextTargetId && contextTargetId !== ROOT_NODE_ID) {
            store.selectNode(contextTargetId);
          }
          handleCopyProperties();
        },
      },
      {
        id: "ctx-paste-properties",
        label: "Paste Properties",
        icon: <FileIcon width={14} height={14} />,
        shortcut: "Ctrl+Shift+V",
        disabled: !canPasteAny,
        onSelect: () => handlePasteProperties("all", propertyTargetIds),
      },
      canPasteAny
        ? {
          id: "ctx-paste-special",
          label: "Paste Special",
          icon: <FileIcon width={14} height={14} />,
          children: [
            {
              id: "ctx-paste-special-all",
              label: "All compatible",
              disabled: !store.canPasteProperties("all", propertyTargetIds),
              onSelect: () => handlePasteProperties("all", propertyTargetIds),
            },
            {
              id: "ctx-paste-special-material",
              label: "Material",
              disabled: !store.canPasteProperties("material", propertyTargetIds),
              onSelect: () => handlePasteProperties("material", propertyTargetIds),
            },
            {
              id: "ctx-paste-special-transform",
              label: "Transform",
              disabled: !store.canPasteProperties("transform", propertyTargetIds),
              onSelect: () => handlePasteProperties("transform", propertyTargetIds),
            },
            {
              id: "ctx-paste-special-geometry",
              label: "Geometry",
              disabled: !store.canPasteProperties("geometry", propertyTargetIds),
              onSelect: () => handlePasteProperties("geometry", propertyTargetIds),
            },
            {
              id: "ctx-paste-special-shadow",
              label: "Shadow",
              disabled: !store.canPasteProperties("shadow", propertyTargetIds),
              onSelect: () => handlePasteProperties("shadow", propertyTargetIds),
            },
          ],
        }
        : { id: "ctx-paste-special", label: "Paste Special", icon: <FileIcon width={14} height={14} />, disabled: true },
      { id: "ctx-divider-2", separator: true },
      { id: "ctx-duplicate", label: "Duplicate", icon: <CopyIcon width={14} height={14} />, shortcut: "Ctrl+C / Ctrl+V", disabled: !contextTargetId || contextTargetId === ROOT_NODE_ID || contextRootIds.length > 1, onSelect: () => handleDuplicate(contextTargetId) },
      { id: "ctx-frame", label: "Frame", icon: <FrameIcon width={14} height={14} />, shortcut: "F", disabled: contextRootIds.length === 0 && !targetNode, onSelect: () => { if (nodeId && !shouldUseExistingSelection) store.selectNode(nodeId); handleFrameSelection(); } },
      { id: "ctx-delete", label: contextRootIds.length > 1 ? "Delete Selected" : "Delete", icon: <TrashIcon width={14} height={14} />, shortcut: "Delete", danger: true, disabled: contextRootIds.length === 0 || (contextRootIds.length === 1 && contextRootIds[0] === ROOT_NODE_ID), onSelect: () => handleDelete(nodeId ?? undefined) },
    ];

    setContextMenu({ x: event.clientX, y: event.clientY, items });
  }, [canGroupNodeIds, createAddMenuActions, handleCopyProperties, handleDelete, handleDuplicate, handleFrameSelection, handleGroupSelection, handlePaste, handlePasteProperties, resolveContextInsertTarget, selectedNodeIdsSet, selectedRootIds, store, storeView]);

  const openViewportContextMenu = useCallback((event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const nodeId = sceneRef.current?.getNodeIdAtClientPoint(event.clientX, event.clientY) ?? null;
    openSceneGraphContextMenu(event, nodeId);
  }, [openSceneGraphContextMenu]);

  const toggleTimelineVisibility = useCallback(() => {
    if (isPhoneLayout) {
      return;
    }
    setIsTimelineVisible((value) => !value);
  }, [isPhoneLayout]);

  const handleToggleTimelineHotkey = useCallback(() => {
    toggleTimelineVisibility();
  }, [toggleTimelineVisibility]);

  const handleDuplicateHotkey = useCallback(() => {
    handleDuplicate();
  }, [handleDuplicate]);

  const handleAddKeyframeAtPlayheadHotkey = useCallback(() => {
    if (!showEditingTimeline || !selectedTrackId) {
      return;
    }
    handleAddAnimationKeyframe(selectedTrackId);
  }, [handleAddAnimationKeyframe, selectedTrackId, showEditingTimeline]);

  const handleSelectAllHotkey = useCallback(() => {
    store.selectAll();
    const count = store.selectedNodeIds.filter((id) => id !== ROOT_NODE_ID).length;
    if (count > 0) {
      setTransientStatus(`Selected ${count} nodes.`);
    }
  }, [setTransientStatus, store]);

  const handleEscapeSelectionHotkey = useCallback(() => {
    store.clearSelection();
  }, [store]);

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
    onCopyProperties: handleCopyProperties,
    onPasteProperties: () => handlePasteProperties("all"),
    onDelete: handleDeleteSelection,
    onFrame: handleFrameSelection,
    onPlayPause: handleAnimationPlayToggle,
    onToolChange: handleToolChange,
    onNew: handleNewBlueprint,
    onOpen: () => { void handleOpenFile(); },
    onSave: () => { void handleSaveProject(); },
    onSaveAs: () => { void handleSaveAsProject(); },
    onToggleTimeline: handleToggleTimelineHotkey,
    onDuplicate: handleDuplicateHotkey,
    onAddKeyframeAtPlayhead: handleAddKeyframeAtPlayheadHotkey,
    onStopAnimation: handleAnimationStop,
    onSelectAll: handleSelectAllHotkey,
    onEscapeSelection: handleEscapeSelectionHotkey,
  });

  const menus = useMemo(() => [
    {
      id: "file",
      label: "File",
      items: [
        { id: "file-new", label: "New Project", icon: <FileIcon width={14} height={14} />, shortcut: "Ctrl+N", onSelect: handleNewBlueprint },
        { id: "file-open", label: "Open File", icon: <DownloadIcon width={14} height={14} />, shortcut: "Ctrl+O", onSelect: handleOpenFile },
        {
          id: "file-open-recent",
          label: "Open Recent",
          children: recentProjects.length > 0
            ? recentProjects.map((entry) => ({
              id: `file-open-recent-${entry.id}`,
              label: entry.label,
              onSelect: () => handleOpenRecent(entry.id),
            }))
            : [{ id: "file-open-recent-empty", label: "No recent projects", disabled: true }],
        },
        { id: "file-divider-1", separator: true },
        { id: "file-save", label: "Save", icon: <DownloadIcon width={14} height={14} />, shortcut: "Ctrl+S", onSelect: () => void handleSaveProject() },
        { id: "file-save-as", label: "Save As", icon: <DownloadIcon width={14} height={14} />, shortcut: "Ctrl+Shift+S", onSelect: () => void handleSaveAsProject() },
        { id: "file-divider-2", separator: true },
        { id: "file-import-json", label: "Import JSON", icon: <FileIcon width={14} height={14} />, onSelect: () => jsonInputRef.current?.click() },
        { id: "file-import-image", label: "Import Image", icon: <ImagePropertyIcon width={14} height={14} />, onSelect: () => requestImageImport({ mode: "create", ...resolveSelectionInsertTarget() }) },
        { id: "file-import-font", label: "Import Font", icon: <TextPropertyIcon width={14} height={14} />, onSelect: () => fontInputRef.current?.click() },
        { id: "file-divider-3", separator: true },
        {
          id: "file-export",
          label: "Export",
          children: [
            { id: "file-export-ts", label: "TypeScript", onSelect: () => downloadExportFile("typescript") },
            { id: "file-export-json", label: "Blueprint", onSelect: () => downloadExportFile("json") },
            { id: "file-export-zip", label: "ZIP file", onSelect: () => void downloadExportPackage() },
          ],
        },
        { id: "file-divider-4", separator: true },
        { id: "file-exit", label: "Exit", danger: true, onSelect: handleExitProject },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "edit-undo", label: "Undo", icon: <UndoIcon width={14} height={14} />, shortcut: "Ctrl+Z", disabled: !storeView.canUndo, onSelect: () => store.undo() },
        { id: "edit-redo", label: "Redo", icon: <RedoIcon width={14} height={14} />, shortcut: "Ctrl+Y", disabled: !storeView.canRedo, onSelect: () => store.redo() },
        { id: "edit-divider-1", separator: true },
        { id: "edit-copy", label: "Copy", icon: <CopyIcon width={14} height={14} />, shortcut: "Ctrl+C", disabled: selectedRootIds.length === 0 || (selectedRootIds.length === 1 && selectedRootIds[0] === ROOT_NODE_ID), onSelect: handleCopy },
        { id: "edit-paste", label: "Paste", icon: <FileIcon width={14} height={14} />, shortcut: "Ctrl+V", disabled: !clipboardRef.current, onSelect: () => handlePaste() },
        {
          id: "edit-copy-properties",
          label: "Copy Properties",
          icon: <CopyIcon width={14} height={14} />,
          shortcut: "Ctrl+Shift+C",
          disabled: !selectedNode || selectedNode.id === ROOT_NODE_ID,
          onSelect: handleCopyProperties,
        },
        {
          id: "edit-paste-properties",
          label: "Paste Properties",
          icon: <FileIcon width={14} height={14} />,
          shortcut: "Ctrl+Shift+V",
          disabled: !storeView.propertyClipboard || !store.canPasteProperties("all"),
          onSelect: () => handlePasteProperties("all"),
        },
        storeView.propertyClipboard && store.canPasteProperties("all")
          ? {
            id: "edit-paste-special",
            label: "Paste Special",
            icon: <FileIcon width={14} height={14} />,
            children: [
              {
                id: "edit-paste-special-all",
                label: "All compatible",
                disabled: !store.canPasteProperties("all"),
                onSelect: () => handlePasteProperties("all"),
              },
              {
                id: "edit-paste-special-material",
                label: "Material",
                disabled: !store.canPasteProperties("material"),
                onSelect: () => handlePasteProperties("material"),
              },
              {
                id: "edit-paste-special-transform",
                label: "Transform",
                disabled: !store.canPasteProperties("transform"),
                onSelect: () => handlePasteProperties("transform"),
              },
              {
                id: "edit-paste-special-geometry",
                label: "Geometry",
                disabled: !store.canPasteProperties("geometry"),
                onSelect: () => handlePasteProperties("geometry"),
              },
              {
                id: "edit-paste-special-shadow",
                label: "Shadow",
                disabled: !store.canPasteProperties("shadow"),
                onSelect: () => handlePasteProperties("shadow"),
              },
            ],
          }
          : { id: "edit-paste-special", label: "Paste Special", icon: <FileIcon width={14} height={14} />, disabled: true },
        { id: "edit-delete", label: "Delete", icon: <TrashIcon width={14} height={14} />, shortcut: "Delete", danger: true, disabled: (!selectedTrackId || !selectedKeyframeId) && (selectedRootIds.length === 0 || (selectedRootIds.length === 1 && selectedRootIds[0] === ROOT_NODE_ID)), onSelect: handleDeleteSelection },
        { id: "edit-divider-2", separator: true },
        { id: "edit-frame", label: "Frame Selection", icon: <FrameIcon width={14} height={14} />, shortcut: "F", disabled: selectedRootIds.length === 0, onSelect: handleFrameSelection },
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
    createAddMenuActions,
    downloadExportFile,
    downloadExportPackage,
    handleCopy,
    handleCopyProperties,
    handleExitProject,
    handleFrameSelection,
    handleNewBlueprint,
    handleOpenFile,
    handleOpenRecent,
    handlePaste,
    handlePasteProperties,
    handleSaveAsProject,
    handleSaveProject,
    requestImageImport,
    recentProjects,
    resolveSelectionInsertTarget,
    selectedKeyframeId,
    selectedNode,
    selectedRootIds,
    selectedTrackId,
    store,
    storeView.canRedo,
    storeView.canUndo,
    storeView.propertyClipboard,
  ]);

  if (!isStarted) {
    return (
      <>
        <LandingPage
          layoutMode={layoutMode}
          persistedWorkspace={persistedWorkspace}
          recentProjects={recentProjects}
          onContinue={handleContinueWorkspace}
          onStartNew={handleNewBlueprint}
          onOpenFile={() => { void handleOpenFile(); }}
          onOpenRecent={(recentProjectId) => { void handleOpenRecent(recentProjectId); }}
          onRemoveRecent={(recentProjectId) => { void handleRemoveRecent(recentProjectId); }}
        />
        <input
          ref={jsonInputRef}
          className="app__hidden-input"
          type="file"
          accept=".json"
          onChange={async (event) => {
            const file = event.target.files?.[0];
            event.currentTarget.value = "";
            if (!file) return;
            try {
              await importJsonFromFile(file);
            } catch {
              setTransientStatus("Unable to import JSON.");
            }
          }}
        />
      </>
    );
  }

  return (
    <div className={`app app--${layoutMode}`} data-status-tick={statusTick} style={shellStyle}>
      {!isPhoneLayout ? <MenuBar menus={menus} appVersion={APP_VERSION} /> : null}

      {!isPhoneLayout ? (
        <SecondaryToolbar
          componentName={storeView.blueprintComponentName}
          selectedLabel={selectedNodeCount > 1
            ? `${selectedNodeCount} selected`
            : selectedNode
              ? `${selectedNode.name} | ${selectedNode.type === "group" ? "Group" : "Mesh"}`
              : "No selection"}
          nodeCount={storeView.blueprintNodes.length}
          canUndo={storeView.canUndo}
          canRedo={storeView.canRedo}
          currentTool={currentTool}
          viewMode={storeView.viewMode}
          playback={activeClip ? {
            isPlaying: isAnimationPlaying,
            currentFrame,
            durationFrames: activeClip.durationFrames,
            onPlayToggle: handleAnimationPlayToggle,
            onStop: handleAnimationStop,
            onRewind: handleAnimationRewind,
            onFastForward: handleAnimationFastForward,
            onSkipBack: handleAnimationSkipBack,
            onSkipForward: handleAnimationSkipForward,
          } : null}
          onComponentNameChange={(value) => store.updateComponentName(value)}
          onUndo={() => { if (store.undo()) setTransientStatus("Undo."); }}
          onRedo={() => { if (store.redo()) setTransientStatus("Redo."); }}
          onToolChange={handleToolChange}
          onViewModeChange={(mode) => store.setViewMode(mode)}
          onFrame={handleFrameSelection}
          isTimelineVisible={isTimelineVisible}
          onToggleTimeline={toggleTimelineVisibility}
          onSave={() => { void handleSaveProject(); }}
          onExport={() => { void downloadExportPackage(); }}
          onShortcuts={() => setIsShortcutDialogOpen(true)}
        />
      ) : (
        <PhoneViewerHeader
          projectName={activeProjectLabel}
          sourceLabel={getProjectSourceLabel(projectContext.source, projectContext.canOverwriteFile)}
          viewMode={storeView.viewMode}
          onFrame={handleFrameSelection}
          onViewModeChange={(mode) => store.setViewMode(mode)}
          onExit={handleExitProject}
        />
      )}

      <div className={shellBodyClassName}>
        {isPhoneLayout ? (
          <div className="phone-shell">
            <ViewportHost
              store={store}
              onSceneReady={(scene) => {
                animationFrameUnsubscribeRef.current?.();
                sceneRef.current = scene;
                scene?.setTransformMode(effectiveToolMode);
                if (scene) {
                  scene.seekAnimation(currentFrame);
                  animationFrameUnsubscribeRef.current = scene.onAnimationFrameChange(handleAnimationFrameChange);
                } else {
                  animationFrameUnsubscribeRef.current = null;
                }
              }}
              onContextMenu={(event) => event.preventDefault()}
            />

            <PhonePlaybackBar
              clips={storeView.animation.clips}
              activeClipId={storeView.animation.activeClipId || activeClip?.id || null}
              currentFrame={currentFrame}
              isPlaying={isAnimationPlaying}
              onSelectClip={handleSelectAnimationClip}
              onPlayToggle={handleAnimationPlayToggle}
              onStop={handleAnimationStop}
              onFrameChange={handleTimelineFrameChange}
            />
          </div>
        ) : (
          <>
            {/* Left column — Scene Graph */}
            <aside className="app__col app__col--left">
              <section className="panel">
                <div className="panel__hd">
                  <span className="panel__hd-icon"><GroupIcon width={12} height={12} /></span>
                  <span className="panel__hd-title">Hierarchy</span>
                  <span className="panel__hd-meta">{storeView.blueprintNodes.length} items</span>
                  <div className="panel__hd-spacer" />
                  <div className="panel__hd-actions">
                    <button
                      type="button"
                      className="tbtn is-ghost"
                      onClick={handleToggleHierarchyCollapse}
                      disabled={collapsibleHierarchyNodeIds.length === 0}
                    >
                      {areAllHierarchyGroupsCollapsed ? "Expand all" : "Collapse all"}
                    </button>
                  </div>
                </div>

                <div className="panel__bd panel__bd--flush">
                  <SceneGraphPanel
                    nodes={storeView.blueprintNodes}
                    animatedNodeIds={animatedNodeIds}
                    selectedNodeId={storeView.selectedNodeId}
                    selectedNodeIds={storeView.selectedNodeIds}
                    collapsedIds={collapsedHierarchyIds}
                    onCollapsedIdsChange={setCollapsedHierarchyIds}
                    onSelectNode={(nodeId, additive) => store.selectNode(nodeId, "ui", additive)}
                    onMoveNode={handleSceneMove}
                    onToggleVisibility={(nodeId) => store.toggleNodeVisibility(nodeId)}
                    onContextMenu={openSceneGraphContextMenu}
                  />
                </div>
              </section>
            </aside>

            <div
              className={`app__sep${resizeMode === "sidebar" ? " is-active" : ""}`}
              onPointerDown={startSidebarResizing}
              data-role="left-separator"
            />

            {/* Center column — Viewport + timeline */}
            <div className={centerColClassName}>
              <div style={{ position: "relative", minWidth: 0, minHeight: 0, overflow: "hidden" }}>
                <ViewportHost
                  store={store}
                  onSceneReady={(scene) => {
                    animationFrameUnsubscribeRef.current?.();
                    sceneRef.current = scene;
                    scene?.setTransformMode(effectiveToolMode);
                    if (scene) {
                      scene.seekAnimation(currentFrame);
                      animationFrameUnsubscribeRef.current = scene.onAnimationFrameChange(handleAnimationFrameChange);
                    } else {
                      animationFrameUnsubscribeRef.current = null;
                    }
                  }}
                  onContextMenu={openViewportContextMenu}
                />
                <div className="vp-hud vp-hud--tl">
                  <div className="hud-group hud-group--lbl">
                    <span>{currentTool}</span>
                    <strong>{storeView.blueprintNodes.length} items</strong>
                  </div>
                </div>
              </div>

              {showEditingTimeline ? (
                <>
                  <div
                    className={`app__sep app__sep--row${resizeMode === "timeline" ? " is-active" : ""}`}
                    onPointerDown={startTimelineResizing}
                  />
                  <AnimationTimeline
                    animation={storeView.animation}
                    nodes={storeView.blueprintNodes}
                    selectedNode={selectedNode}
                    currentFrame={currentFrame}
                    selectedTrackId={selectedTrackId}
                    selectedKeyframeId={selectedKeyframeId}
                    onFrameChange={handleTimelineFrameChange}
                    onAnimationConfigChange={(patch) => store.updateAnimationConfig(patch)}
                    onCreateClip={handleCreateAnimationClip}
                    onSelectClip={handleSelectAnimationClip}
                    onRenameClip={handleRenameAnimationClip}
                    onRemoveClip={handleRemoveAnimationClip}
                    onAddTrack={handleAddAnimationTrack}
                    onRemoveTrack={handleRemoveAnimationTrack}
                    onAddKeyframe={handleAddAnimationKeyframe}
                    onSelectTrack={handleSelectAnimationTrack}
                    onSelectKeyframe={handleSelectAnimationKeyframe}
                    onUpdateKeyframe={handleUpdateAnimationKeyframe}
                    onRemoveKeyframe={handleRemoveAnimationKeyframe}
                    onDuplicateClip={handleDuplicateAnimationClip}
                    onSetTrackMuted={handleSetAnimationTrackMuted}
                    onRemoveKeyframes={handleRemoveAnimationKeyframes}
                    onShiftKeyframes={handleShiftAnimationKeyframes}
                    onBeginKeyframeDrag={() => store.beginHistoryTransaction()}
                    onEndKeyframeDrag={() => {
                      store.commitHistoryTransaction("ui");
                      sceneRef.current?.seekAnimation(currentFrame);
                    }}
                  />
                </>
              ) : null}
            </div>

            <div
              className={`app__sep${resizeMode === "sidebar" ? " is-active" : ""}`}
              onPointerDown={startSidebarResizing}
              data-role="right-separator"
            />

            {/* Right column — Inspector/Fields/Export */}
            <aside className="app__col app__col--right">
              <div className="panel__hd">
                <div className="ptabs" role="tablist" aria-label="Right panel tabs">
                  <button
                    type="button"
                    className={`ptab${rightPanelTab === "inspector" ? " is-active" : ""}`}
                    onClick={() => setRightPanelTab("inspector")}
                    role="tab"
                    aria-selected={rightPanelTab === "inspector"}
                  >
                    Inspector
                  </button>
                  <button
                    type="button"
                    className={`ptab${rightPanelTab === "fields" ? " is-active" : ""}`}
                    onClick={() => setRightPanelTab("fields")}
                    role="tab"
                    aria-selected={rightPanelTab === "fields"}
                  >
                    Fields
                  </button>
                  <button
                    type="button"
                    className={`ptab${rightPanelTab === "export" ? " is-active" : ""}`}
                    onClick={() => setRightPanelTab("export")}
                    role="tab"
                    aria-selected={rightPanelTab === "export"}
                  >
                    Export
                  </button>
                </div>
                <div className="panel__hd-spacer" />
              </div>

              <div className="panel__bd">
                {rightPanelTab === "inspector" ? (
                  <InspectorPanel
                    node={inspectorNode}
                    nodes={selectedNodes}
                    emptyMessage={selectedNodeCount > 1 ? "No shared inspector controls are available for this selection." : undefined}
                    fonts={storeView.fonts}
                    onNodeNameChange={(nodeId, value) => store.updateNodeName(nodeId, value)}
                    onParentChange={(nodeId, parentId) => {
                      const eligibleChildren = store.getNodeChildren(parentId);
                      store.moveNode(nodeId, parentId, eligibleChildren.length);
                    }}
                    onNodeOriginChange={(nodeId, origin) => store.updateNodeOrigin(nodeId, origin)}
                    onGroupPivotPresetApply={handleApplyGroupPivotPreset}
                    getEligibleParents={(nodeId) => store.getEligibleParents(nodeId)}
                    onNodePropertyChange={(nodeId, definition, value) => store.updateNodeProperty(nodeId, definition, value)}
                    onNodesPropertyChange={(nodeIds, definition, value) => store.updateNodesProperty(nodeIds, definition, value)}
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
            </aside>
          </>
        )}
      </div>

      <footer className="statusbar">
        <div className="statusbar__left">
          <span className="statusbar__dot" aria-hidden="true" />
          <span>{statusText}</span>
        </div>
        <div className="statusbar__right">
          {isPhoneLayout ? (
            <span className="statusbar__chip">{`${getProjectSourceLabel(projectContext.source, projectContext.canOverwriteFile)} · ${storeView.blueprintNodes.length} nodes`}</span>
          ) : (
            <>
              <span className="statusbar__chip">local workspace saved</span>
              <span className="statusbar__sep">·</span>
              <span className="statusbar__chip">{getProjectSourceLabel(projectContext.source, projectContext.canOverwriteFile)}</span>
              <span className="statusbar__sep">·</span>
              <span className="statusbar__chip">{storeView.blueprintNodes.length} nodes</span>
            </>
          )}
        </div>
      </footer>

      <input
        ref={jsonInputRef}
        className="app__hidden-input"
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
        className="app__hidden-input"
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
        className="app__hidden-input"
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
      {toast ? (
        <div
          role="status"
          aria-live="polite"
          className={`toast${toast.tone === "warning" ? " is-warning" : ""}`}
        >
          {toast.message}
        </div>
      ) : null}
      <ShortcutDialog isOpen={isShortcutDialogOpen} onClose={() => setIsShortcutDialogOpen(false)} />

      <Modal title="About 3Forge" isOpen={isAboutDialogOpen} onClose={() => setIsAboutDialogOpen(false)}>
        <p>3Forge is a standalone 3D component editor focused on building reusable Three.js pieces with runtime-editable fields.</p>
        <p>The viewport, history, export pipeline, fonts, images, and scene state stay in the editor core. React now handles the software-like shell, menus, panels, and scene graph workflow.</p>
      </Modal>
    </div>
  );
}
