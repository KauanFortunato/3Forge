import { useMemo, useSyncExternalStore } from "react";
import { EditorStore } from "../../state";
import type { EditorStoreView } from "../ui-types";

export function useEditorStoreSnapshot(store: EditorStore): EditorStoreView {
  const revision = useSyncExternalStore(
    (callback) => store.subscribe(() => callback()),
    () => store.revision,
  );

  return useMemo(
    () => ({
      blueprintComponentName: store.blueprint.componentName,
      blueprintSceneMode: store.blueprint.sceneMode === "2d" ? "2d" : "3d",
      blueprintNodes: store.blueprint.nodes,
      selectedNodeId: store.selectedNodeId,
      selectedNodeIds: store.selectedNodeIds,
      selectedNode: store.selectedNode,
      selectedNodes: store.selectedNodes,
      fonts: store.fonts,
      materials: store.materials,
      images: store.images,
      editableFields: store.listEditableFields(),
      animation: store.animation,
      selectedNodeAnimationTracks: store.getAnimationTracksForNode(store.selectedNodeId),
      canUndo: store.canUndo,
      canRedo: store.canRedo,
      viewMode: store.viewMode,
      propertyClipboard: store.propertyClipboard,
    }),
    [store, revision],
  );
}
