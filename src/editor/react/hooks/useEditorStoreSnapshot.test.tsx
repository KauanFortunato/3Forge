import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createDefaultBlueprint, EditorStore, ROOT_NODE_ID } from "../../state";
import { useEditorStoreSnapshot } from "./useEditorStoreSnapshot";

describe("useEditorStoreSnapshot", () => {
  it("refreshes blueprint node array references after undo restores deleted nodes", () => {
    const store = new EditorStore(createDefaultBlueprint());
    const { result } = renderHook(() => useEditorStoreSnapshot(store));
    const initialNodes = result.current.blueprintNodes;
    const deletedNodeId = initialNodes.find((node) => node.id !== ROOT_NODE_ID)?.id;
    expect(deletedNodeId).toBeTruthy();

    act(() => {
      store.deleteNode(deletedNodeId!);
    });

    const nodesAfterDelete = result.current.blueprintNodes;
    expect(nodesAfterDelete).not.toBe(initialNodes);
    expect(nodesAfterDelete.some((node) => node.id === deletedNodeId)).toBe(false);

    act(() => {
      expect(store.undo()).toBe(true);
    });

    expect(result.current.blueprintNodes).not.toBe(nodesAfterDelete);
    expect(result.current.blueprintNodes.some((node) => node.id === deletedNodeId)).toBe(true);
  });
});
