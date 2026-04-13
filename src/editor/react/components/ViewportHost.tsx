import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { SceneEditor } from "../../scene";
import { EditorStore } from "../../state";

interface ViewportHostProps {
  store: EditorStore;
  onSceneReady: (scene: SceneEditor | null) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
}

export function ViewportHost({ store, onSceneReady, onContextMenu }: ViewportHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSceneReadyRef = useRef(onSceneReady);

  useEffect(() => {
    onSceneReadyRef.current = onSceneReady;
  }, [onSceneReady]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const scene = new SceneEditor(container, store);
    onSceneReadyRef.current(scene);

    return () => {
      onSceneReadyRef.current(null);
      scene.dispose();
    };
  }, [store]);

  return (
    <div
      ref={containerRef}
      className="viewport-canvas"
      tabIndex={0}
      onPointerDown={(event) => {
        const activeElement = document.activeElement;
        if (
          activeElement instanceof HTMLInputElement ||
          activeElement instanceof HTMLTextAreaElement ||
          activeElement instanceof HTMLSelectElement
        ) {
          activeElement.blur();
        }

        event.currentTarget.focus({ preventScroll: true });
      }}
      onContextMenu={onContextMenu}
    />
  );
}
