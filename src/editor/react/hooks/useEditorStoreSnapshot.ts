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
      blueprintNodes: store.blueprint.nodes,
      selectedNodeId: store.selectedNodeId,
      selectedNode: store.selectedNode,
      fonts: store.fonts,
      editableFields: store.listEditableFields(),
      canUndo: store.canUndo,
      canRedo: store.canRedo,
      viewMode: store.viewMode,
    }),
    [store, revision],
  );
}
