import { useEffect, useRef } from "react";
import type { MouseEvent } from "react";
import { SceneEditor } from "../../scene";
import { EditorStore } from "../../state";

const CONTEXT_MENU_DRAG_THRESHOLD = 5;

interface ViewportHostProps {
  store: EditorStore;
  onSceneReady: (scene: SceneEditor | null) => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
}

export function ViewportHost({ store, onSceneReady, onContextMenu }: ViewportHostProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onSceneReadyRef = useRef(onSceneReady);
  const rightPointerStateRef = useRef<{ pointerId: number; x: number; y: number; moved: boolean } | null>(null);

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

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const state = rightPointerStateRef.current;
      if (!state || event.pointerId !== state.pointerId) {
        return;
      }

      const deltaX = Math.abs(event.clientX - state.x);
      const deltaY = Math.abs(event.clientY - state.y);
      if (deltaX > CONTEXT_MENU_DRAG_THRESHOLD || deltaY > CONTEXT_MENU_DRAG_THRESHOLD) {
        rightPointerStateRef.current = { ...state, moved: true };
      }
    };

    const clearPointerState = (event: PointerEvent) => {
      const state = rightPointerStateRef.current;
      if (!state || event.pointerId !== state.pointerId) {
        return;
      }

      rightPointerStateRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", clearPointerState);
    window.addEventListener("pointercancel", clearPointerState);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", clearPointerState);
      window.removeEventListener("pointercancel", clearPointerState);
    };
  }, []);

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

        if (event.button === 2) {
          rightPointerStateRef.current = {
            pointerId: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            moved: false,
          };
        }
      }}
      onContextMenu={(event) => {
        const state = rightPointerStateRef.current;
        rightPointerStateRef.current = null;

        if (state?.moved) {
          event.preventDefault();
          return;
        }

        onContextMenu(event);
      }}
    />
  );
}
