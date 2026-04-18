import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { exportBlueprintToJson, generateTypeScriptComponent } from "../exports";
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

const APP_LOGO_SRC = "/assets/web/logo.svg";

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

  return (
    <div className={`landing-page landing-page--${layoutMode}`}>
      <div className="landing-page__content">
        <div className="landing-page__logo">
          <img src={APP_LOGO_SRC} alt="3Forge" className="landing-page__logo-image" />
        </div>
        <h1 className="landing-page__title">{isPhoneLayout ? "3Forge" : "3Forge Editor"}</h1>
        <p className="landing-page__subtitle">
          {isPhoneLayout
            ? "Open projects, review scenes and play animations on this device."
            : isTabletLayout
              ? "Resume quickly, open files and keep editing in a compact workspace."
              : "Design, prototype, and export high-performance 3D components for your applications."}
        </p>

        {!isPhoneLayout ? (
          <div className="landing-page__summary">
            <div className="landing-summary-card">
              <span className="landing-summary-card__label">Mode</span>
              <strong className="landing-summary-card__value">{isTabletLayout ? "Compact editor" : "Full editor"}</strong>
            </div>
            <div className="landing-summary-card">
              <span className="landing-summary-card__label">Local session</span>
              <strong className="landing-summary-card__value">{persistedWorkspace ? "Available" : "Empty"}</strong>
            </div>
            <div className="landing-summary-card">
              <span className="landing-summary-card__label">Recents</span>
              <strong className="landing-summary-card__value">{recentProjects.length}</strong>
            </div>
          </div>
        ) : null}

        <div className="landing-page__grid">
          <section className="landing-page__panel landing-page__panel--primary">
            <div className="landing-page__panel-header">
              <p className="landing-page__eyebrow">Workspace</p>
              <h2 className="landing-page__panel-title">
                {isPhoneLayout
                  ? "Open or resume a project on this device."
                  : isTabletLayout
                    ? "Resume fast or start another project."
                    : "Start from a local project or a file."}
              </h2>
            </div>

            {isPhoneLayout ? (
              <p className="landing-page__panel-copy">
                Phone mode is focused on loading projects and playing timelines. Use tablet or desktop for full editing.
              </p>
            ) : null}

            <div className="landing-page__actions">
              {persistedWorkspace ? (
                <button type="button" className="landing-btn landing-btn--primary" onClick={onContinue}>
                  <FrameIcon width={20} height={20} />
                  <div className="landing-btn__text">
                    <span className="landing-btn__label">Continue where you left off</span>
                    <span className="landing-btn__desc">{`${localProjectSourceLabel} · ${localProjectLabel}`}</span>
                  </div>
                </button>
              ) : null}

              {isPhoneLayout ? (
                <div className="landing-page__quick-actions">
                  <button type="button" className="landing-btn landing-btn--secondary landing-btn--compact" onClick={onOpenFile}>
                    <DownloadIcon width={18} height={18} />
                    <div className="landing-btn__text">
                      <span className="landing-btn__label">Open file</span>
                      <span className="landing-btn__desc">Load a blueprint</span>
                    </div>
                  </button>

                  <button type="button" className="landing-btn landing-btn--secondary landing-btn--compact" onClick={onStartNew}>
                    <PlusIcon width={18} height={18} />
                    <div className="landing-btn__text">
                      <span className="landing-btn__label">New project</span>
                      <span className="landing-btn__desc">Start clean</span>
                    </div>
                  </button>
                </div>
              ) : (
                <>
                  <button type="button" className="landing-btn landing-btn--secondary" onClick={onOpenFile}>
                    <DownloadIcon width={20} height={20} />
                    <div className="landing-btn__text">
                      <span className="landing-btn__label">Open file</span>
                      <span className="landing-btn__desc">Load a blueprint from your machine</span>
                    </div>
                  </button>

                  <button type="button" className="landing-btn landing-btn--secondary" onClick={onStartNew}>
                    <PlusIcon width={20} height={20} />
                    <div className="landing-btn__text">
                      <span className="landing-btn__label">New project</span>
                      <span className="landing-btn__desc">Start from a clean slate</span>
                    </div>
                  </button>
                </>
              )}
            </div>
          </section>

          <section className="landing-page__panel landing-page__panel--recent">
            <div className="landing-page__panel-header">
              <p className="landing-page__eyebrow">Recents</p>
              <h2 className="landing-page__panel-title">{isPhoneLayout ? "Recent projects" : "Open recent"}</h2>
            </div>

            {recentProjects.length > 0 ? (
              <div className="landing-page__recent-list">
                {recentProjects.map((entry) => (
                  <div key={entry.id} className="landing-recent">
                    <button
                      type="button"
                      className="landing-recent__remove"
                      aria-label={`Remove ${entry.label} from recents`}
                      onClick={() => onRemoveRecent(entry.id)}
                    >
                      <span aria-hidden="true">x</span>
                    </button>
                    <button
                      type="button"
                      className="landing-recent__open"
                      onClick={() => onOpenRecent(entry.id)}
                    >
                      <span className="landing-recent__title">{entry.label}</span>
                      <span className="landing-recent__meta">
                        {entry.source === "file-handle" ? "Linked file" : "Local snapshot"}
                        {" · "}
                        {entry.componentName}
                        {" · "}
                        {formatRecentProjectTime(entry.updatedAt)}
                      </span>
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="landing-page__empty">
                Projects you opened or imported recently appear here and can be reopened later.
              </div>
            )}
          </section>
        </div>

        <div className="landing-page__footer">
          {isPhoneLayout
            ? "Reload keeps your current session. Leaving the app returns here without deleting local work."
            : "Reload keeps your current session in place. Reopening the app brings you back to this launcher without deleting local work."}
        </div>
      </div>
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
  const [isShortcutDialogOpen, setIsShortcutDialogOpen] = useState(false);
  const [isAboutDialogOpen, setIsAboutDialogOpen] = useState(false);
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
  const shellBodyClassName = `app-shell__body${showEditingTimeline ? " has-timeline" : ""}${isPhoneLayout ? " app-shell__body--phone" : ""}`;
  const rightPanelStyle = useMemo(
    () => ({ "--hierarchy-panel-height": `${hierarchyHeight}px` }) as CSSProperties,
    [hierarchyHeight],
  );
  const timelineDockStyle = useMemo(
    () => ({ gridTemplateRows: `8px ${timelineHeight}px` }) as CSSProperties,
    [timelineHeight],
  );
  const selectedNodeIds = storeView.selectedNodeIds;
  const selectedNodeIdsSet = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const selectedNodeCount = selectedNodeIds.length;
  const selectedNode = storeView.selectedNode;
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
    }: {
      recentProjectId?: string;
      fileName?: string | null;
      handle?: BrowserFileSystemFileHandle | null;
    } = {},
  ) => {
    let fileHandleId = projectContext.fileHandleId;
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
    const addActions = createAddMenuActions(() => resolveContextInsertTarget(nodeId));
    const items: MenuAction[] = [
      { id: "ctx-new", label: "New", icon: <MeshIcon width={14} height={14} />, children: addActions },
      { id: "ctx-paste", label: "Paste", icon: <FileIcon width={14} height={14} />, shortcut: "Ctrl+V", disabled: !clipboardRef.current, onSelect: () => handlePaste(nodeId) },
      canGroupSelection
        ? { id: "ctx-group-selection", label: "Group Selected", icon: <GroupIcon width={14} height={14} />, onSelect: () => handleGroupSelection(nodeId) }
        : { id: "ctx-group-selection", label: "Group Selected", icon: <GroupIcon width={14} height={14} />, disabled: true },
      { id: "ctx-divider-1", separator: true },
      { id: "ctx-duplicate", label: "Duplicate", icon: <CopyIcon width={14} height={14} />, shortcut: "Ctrl+C / Ctrl+V", disabled: !contextTargetId || contextTargetId === ROOT_NODE_ID || contextRootIds.length > 1, onSelect: () => handleDuplicate(contextTargetId) },
      { id: "ctx-frame", label: "Frame", icon: <FrameIcon width={14} height={14} />, shortcut: "F", disabled: contextRootIds.length === 0 && !targetNode, onSelect: () => { if (nodeId && !shouldUseExistingSelection) store.selectNode(nodeId); handleFrameSelection(); } },
      { id: "ctx-delete", label: contextRootIds.length > 1 ? "Delete Selected" : "Delete", icon: <TrashIcon width={14} height={14} />, shortcut: "Delete", danger: true, disabled: contextRootIds.length === 0 || (contextRootIds.length === 1 && contextRootIds[0] === ROOT_NODE_ID), onSelect: () => handleDelete(nodeId ?? undefined) },
    ];

    setContextMenu({ x: event.clientX, y: event.clientY, items });
  }, [canGroupNodeIds, createAddMenuActions, handleDelete, handleDuplicate, handleFrameSelection, handleGroupSelection, handlePaste, resolveContextInsertTarget, selectedNodeIdsSet, selectedRootIds, store]);

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
    onNew: handleNewBlueprint,
    onOpen: () => { void handleOpenFile(); },
    onSave: () => { void handleSaveProject(); },
    onSaveAs: () => { void handleSaveAsProject(); },
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
        { id: "file-export-json", label: "Download Blueprint JSON", onSelect: () => downloadExportFile("json") },
        { id: "file-export-ts", label: "Download TypeScript", onSelect: () => downloadExportFile("typescript") },
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
    handleCopy,
    handleExitProject,
    handleFrameSelection,
    handleNewBlueprint,
    handleOpenFile,
    handleOpenRecent,
    handlePaste,
    handleSaveAsProject,
    handleSaveProject,
    requestImageImport,
    recentProjects,
    resolveSelectionInsertTarget,
    selectedKeyframeId,
    selectedRootIds,
    selectedTrackId,
    store,
    storeView.canRedo,
    storeView.canUndo,
  ]);

  if (!isStarted) {
    return (
      <div className={`app-shell app-shell--landing app-shell--${layoutMode}`}>
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
          className="hidden-input"
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
      </div>
    );
  }

  return (
    <div className={`app-shell app-shell--${layoutMode}`} data-status-tick={statusTick}>
      {!isPhoneLayout ? <MenuBar menus={menus} /> : null}

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
          onComponentNameChange={(value) => store.updateComponentName(value)}
          onUndo={() => { if (store.undo()) setTransientStatus("Undo."); }}
          onRedo={() => { if (store.redo()) setTransientStatus("Redo."); }}
          onToolChange={handleToolChange}
          onViewModeChange={(mode) => store.setViewMode(mode)}
          onFrame={handleFrameSelection}
          isTimelineVisible={isTimelineVisible}
          onToggleTimeline={() => setIsTimelineVisible((value) => !value)}
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
          <div className="phone-viewer-shell">
            <main className="viewport-panel viewport-panel--phone">
              <div className="viewport-panel__header viewport-panel__header--compact">
                <span className="viewport-panel__title">Viewport</span>
                <div className="viewport-panel__badges">
                  <span className="badge">{storeView.viewMode}</span>
                  <span className="badge">{storeView.blueprintNodes.length} items</span>
                </div>
              </div>

              <div className="viewport-panel__body">
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
              </div>
            </main>

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
            <div
              className={`workspace-shell workspace-shell--${layoutMode}`}
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
                </div>
              </main>

              {!isCompactLayout ? (
                <div
                  className={`panel-splitter panel-splitter--vertical${resizeMode === "sidebar" ? " is-active" : ""}`}
                  onPointerDown={startSidebarResizing}
                />
              ) : null}

              <aside className="panel panel--right panel--split" style={rightPanelStyle}>
                <section className="panel-split__top">
                  <div className="panel__header">
                    <p className="panel__eyebrow">Hierarchy</p>
                    <span className="panel__meta">{storeView.blueprintNodes.length} items</span>
                  </div>

                  <div className="panel__body panel__body--flush">
                    <SceneGraphPanel
                      nodes={storeView.blueprintNodes}
                      animatedNodeIds={animatedNodeIds}
                      selectedNodeId={storeView.selectedNodeId}
                      selectedNodeIds={storeView.selectedNodeIds}
                      onSelectNode={(nodeId, additive) => store.selectNode(nodeId, "ui", additive)}
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
                        node={inspectorNode}
                        emptyMessage={selectedNodeCount > 1 ? "Inspector indisponível para seleção múltipla." : undefined}
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

            {showEditingTimeline ? (
              <div className="app-shell__timeline-dock" style={timelineDockStyle}>
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
                  onCreateClip={handleCreateAnimationClip}
                  onSelectClip={handleSelectAnimationClip}
                  onRenameClip={handleRenameAnimationClip}
                  onRemoveClip={handleRemoveAnimationClip}
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
              </div>
            ) : null}
          </>
        )}
      </div>

      <footer className={`statusbar${isPhoneLayout ? " statusbar--phone" : ""}`}>
        <span className="statusbar__message">{statusText}</span>
        <div className="statusbar__right">
          {isPhoneLayout ? (
            <span className="statusbar__chip">{`${getProjectSourceLabel(projectContext.source, projectContext.canOverwriteFile)} · ${storeView.blueprintNodes.length} nodes`}</span>
          ) : (
            <>
              <span className="statusbar__chip">local workspace saved</span>
              <span className="statusbar__chip">{getProjectSourceLabel(projectContext.source, projectContext.canOverwriteFile)}</span>
              <span className="statusbar__chip">{storeView.blueprintNodes.length} nodes</span>
            </>
          )}
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
