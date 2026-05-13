import { useCallback, useMemo, useSyncExternalStore } from "react";
import { EditorStore } from "../../state";
import type { EditorStoreView } from "../ui-types";

export function useEditorStoreSnapshot(store: EditorStore): EditorStoreView {
  // Both arguments to `useSyncExternalStore` must be referentially stable
  // across renders — React 18 unsubscribes + resubscribes whenever the
  // subscribe function changes, and a fresh `getSnapshot` arrow risks
  // tearing checks under StrictMode. Wrap both in `useCallback` keyed on
  // the store so they only change when the store instance itself changes
  // (which it doesn't, in practice). Without this the `<App>` autosave
  // effect downstream can observe a phantom revision change after a large
  // W3D import lands several setStates in quick succession.
  const subscribe = useCallback(
    (callback: () => void) => store.subscribe(() => callback()),
    [store],
  );
  const getSnapshot = useCallback(() => store.revision, [store]);
  const revision = useSyncExternalStore(subscribe, getSnapshot);

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
