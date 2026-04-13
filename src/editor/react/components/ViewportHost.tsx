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
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);

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

        // Rastrear início do clique com botão direito (button 2)
        if (event.button === 2) {
          dragStartRef.current = { x: event.clientX, y: event.clientY };
        }
      }}
      onContextMenu={(event) => {
        if (dragStartRef.current) {
          const deltaX = Math.abs(event.clientX - dragStartRef.current.x);
          const deltaY = Math.abs(event.clientY - dragStartRef.current.y);
          const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
          
          dragStartRef.current = null;

          // Se moveu mais de 5 pixels, é um arraste da câmera, cancela o menu
          if (distance > 5) {
            event.preventDefault();
            return;
          }
        }
        
        onContextMenu(event);
      }}
    />
  );
}
