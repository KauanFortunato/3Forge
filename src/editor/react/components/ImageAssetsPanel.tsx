import { useEffect, useState } from "react";
import type { MouseEvent } from "react";
import { isVideoMimeType } from "../../images";
import type { ImageAsset } from "../../types";
import { AssignIcon, ImageIcon, PlusIcon, TrashIcon, DownloadIcon } from "./icons";

export interface ProjectImageAsset extends ImageAsset {
  id: string;
}

interface ImageAssetsPanelProps {
  images: ProjectImageAsset[];
  selectedImageId: string | null;
  selectedImageNodeCount: number;
  usageById: Record<string, number>;
  onSelectImage: (imageId: string | null) => void;
  onImport: () => void;
  onApplyToSelection: (image: ProjectImageAsset) => void;
  onCreateNode: (image: ProjectImageAsset) => void;
  onReplace: (imageId: string) => void;
  onRemove: (imageId: string) => void;
  canRemoveImage: (imageId: string) => boolean;
}

interface PreviewEntry {
  frame: number;
  playing: boolean;
  intervalId: number | null;
}

function isImageSequence(image: ProjectImageAsset): boolean {
  return image.mimeType === "application/x-image-sequence" && !!image.sequence;
}

export function ImageAssetsPanel(props: ImageAssetsPanelProps) {
  const {
    images,
    selectedImageId,
    selectedImageNodeCount,
    usageById,
    onSelectImage,
    onImport,
    onApplyToSelection,
    onCreateNode,
    onReplace,
    onRemove,
    canRemoveImage,
  } = props;

  const [loadedSrcById, setLoadedSrcById] = useState<Record<string, string>>({});
  const [previewState, setPreviewState] = useState<Record<string, PreviewEntry>>({});

  useEffect(() => {
    return () => {
      setPreviewState((prev) => {
        for (const k of Object.keys(prev)) {
          const id = prev[k]?.intervalId;
          if (id != null) clearInterval(id);
        }
        return {};
      });
    };
  }, []);

  // Autoplay every image-sequence asset that's currently in the panel like
  // a video thumbnail (Loom / YouTube preview behaviour). When an asset
  // leaves the list its interval is torn down. Once the user has interacted
  // (Pause), the entry exists in previewState and we leave it alone -- no
  // surprise restart.
  const sequenceSignature = images
    .filter((image) => isImageSequence(image))
    .map((image) => image.id)
    .join(",");
  useEffect(() => {
    setPreviewState((prev) => {
      const next: Record<string, PreviewEntry> = { ...prev };
      const knownIds = new Set(images.map((i) => i.id));

      // Stop intervals for assets that no longer exist in the prop list.
      for (const id of Object.keys(next)) {
        if (!knownIds.has(id)) {
          const intervalId = next[id]?.intervalId;
          if (intervalId != null) clearInterval(intervalId);
          delete next[id];
        }
      }

      // Start intervals for sequence assets that have never been touched.
      for (const image of images) {
        if (!isImageSequence(image)) continue;
        const seq = image.sequence;
        if (!seq || seq.frameUrls.length === 0) continue;
        if (next[image.id] != null) continue; // user already interacted, leave alone
        const fps = seq.fps > 0 ? seq.fps : 25;
        const intervalId = window.setInterval(() => {
          setPreviewState((p) => {
            const c = p[image.id];
            if (!c || !c.playing) return p;
            const nextFrame = (c.frame + 1) % seq.frameUrls.length;
            return { ...p, [image.id]: { ...c, frame: nextFrame } };
          });
        }, 1000 / fps);
        next[image.id] = { frame: 0, playing: true, intervalId };
      }

      return next;
    });
    // sequenceSignature is a derived dep that changes only when the set of
    // sequence asset ids changes; this avoids re-running on every parent
    // re-render even if `images` reference identity changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sequenceSignature]);

  const stop = (event: MouseEvent) => {
    event.stopPropagation();
  };

  const markLoaded = (id: string, src: string) => {
    setLoadedSrcById((prev) => (prev[id] === src ? prev : { ...prev, [id]: src }));
  };

  const togglePreview = (image: ProjectImageAsset) => {
    const seq = image.sequence;
    if (!seq || seq.frameUrls.length === 0) return;
    setPreviewState((prev) => {
      const cur = prev[image.id];
      if (cur?.playing && cur.intervalId != null) {
        clearInterval(cur.intervalId);
        return { ...prev, [image.id]: { frame: cur.frame, playing: false, intervalId: null } };
      }
      const fps = seq.fps > 0 ? seq.fps : 25;
      const id = window.setInterval(() => {
        setPreviewState((p) => {
          const c = p[image.id];
          if (!c || !c.playing) return p;
          const next = (c.frame + 1) % seq.frameUrls.length;
          return { ...p, [image.id]: { ...c, frame: next } };
        });
      }, 1000 / fps);
      return {
        ...prev,
        [image.id]: { frame: cur?.frame ?? 0, playing: true, intervalId: id },
      };
    });
  };

  return (
    <div className="image-assets-panel">
      <div className="image-assets-panel__head">
        <span>Media</span>
        <div className="image-assets-panel__head-actions">
          <button
            type="button"
            className="ibtn"
            onClick={onImport}
            aria-label="Import media asset"
            title="Import media asset"
          >
            <PlusIcon width={11} height={11} />
          </button>
        </div>
      </div>

      {images.length === 0 ? (
        <div className="panel__empty">
          No reusable media yet. Import an image or video to place it in the scene.
        </div>
      ) : (
        <div className="image-assets-panel__list">
          {images.map((image) => {
            const usage = usageById[image.id] ?? 0;
            const isActive = image.id === selectedImageId;
            const canApply = selectedImageNodeCount > 0;
            const canRemove = canRemoveImage(image.id);
            const isSeq = isImageSequence(image);
            const seq = image.sequence;
            const seqEmpty = isSeq && (!seq || seq.frameUrls.length === 0);
            const isVideo = !isSeq && isVideoMimeType(image.mimeType);
            const kindLabel = isSeq ? "sequence" : isVideo ? "video" : "image";
            const localFrame = previewState[image.id]?.frame ?? 0;
            const localPlaying = previewState[image.id]?.playing ?? false;
            const currentSrc =
              isSeq && seq && seq.frameUrls[localFrame]
                ? seq.frameUrls[localFrame]
                : image.src;

            return (
              <div
                key={image.id}
                className={`image-assets-panel__item${isActive ? " is-active" : ""}`}
              >
                <button
                  type="button"
                  className="image-assets-panel__item-main"
                  onClick={() => onSelectImage(image.id)}
                  aria-label={`Select ${image.name}`}
                  title={`Select ${image.name}`}
                >
                  {isSeq ? (
                    <span className="image-assets-panel__thumb" aria-hidden="true">
                      {seqEmpty ? (
                        <span className="image-assets-panel__sequence-warning">
                          Frames missing
                        </span>
                      ) : (
                        <>
                          <img
                            src={currentSrc}
                            alt=""
                            onLoad={() => markLoaded(image.id, currentSrc)}
                            onError={() => markLoaded(image.id, currentSrc)}
                          />
                          <button
                            type="button"
                            className="image-assets-panel__seq-play"
                            onClick={(e) => {
                              e.stopPropagation();
                              togglePreview(image);
                            }}
                            aria-label={
                              localPlaying
                                ? `Pause sequence preview for ${image.name}`
                                : `Play sequence preview for ${image.name}`
                            }
                            title={localPlaying ? "Pause preview" : "Play preview"}
                          >
                            {localPlaying ? "⏸" : "▶"}
                          </button>
                        </>
                      )}
                      {!seqEmpty && loadedSrcById[image.id] !== currentSrc ? (
                        <span
                          className="image-assets-panel__thumb-loading"
                          aria-label="Loading sequence"
                          role="status"
                        >
                          <span className="image-assets-panel__thumb-spinner" aria-hidden="true" />
                        </span>
                      ) : null}
                    </span>
                  ) : (
                    <span className="image-assets-panel__thumb" aria-hidden="true">
                      {isVideo ? (
                        <video
                          src={image.src}
                          muted
                          loop
                          autoPlay
                          playsInline
                          onLoadedData={() => markLoaded(image.id, image.src)}
                          onError={() => markLoaded(image.id, image.src)}
                        />
                      ) : (
                        <img
                          src={image.src}
                          alt=""
                          onLoad={() => markLoaded(image.id, image.src)}
                          onError={() => markLoaded(image.id, image.src)}
                        />
                      )}
                      {loadedSrcById[image.id] === image.src ? null : (
                        <span className="image-assets-panel__thumb-loading" aria-label={`Loading ${kindLabel}`} role="status">
                          <span className="image-assets-panel__thumb-spinner" aria-hidden="true" />
                        </span>
                      )}
                    </span>
                  )}
                  <span className="image-assets-panel__meta">
                    <span className="image-assets-panel__name">
                      {image.name}
                      {isSeq ? (
                        <span className="image-assets-panel__badge">SEQUENCE</span>
                      ) : isVideo ? (
                        <span className="image-assets-panel__badge">VIDEO</span>
                      ) : null}
                    </span>
                    <span className="image-assets-panel__sub">
                      {isSeq && seq
                        ? `${seq.frameCount} frames @ ${seq.fps || 25} fps · ${seq.alpha ? "alpha" : "no alpha"}`
                        : `${image.width} x ${image.height}px - ${usage} use${usage === 1 ? "" : "s"}`}
                    </span>
                  </span>
                  <span className="image-assets-panel__icon" aria-hidden="true">
                    <ImageIcon width={11} height={11} />
                  </span>
                </button>
                <div className="image-assets-panel__item-actions" onClick={stop}>
                  <button
                    type="button"
                    className="ibtn"
                    onClick={() => onApplyToSelection(image)}
                    disabled={!canApply}
                    aria-label={`Apply ${kindLabel} asset to selected media nodes`}
                    title={canApply
                      ? `Apply to selected media nodes`
                      : `Select a media node to apply this asset`}
                  >
                    <AssignIcon width={11} height={11} />
                  </button>
                  <button
                    type="button"
                    className="ibtn"
                    onClick={() => onCreateNode(image)}
                    aria-label={`Create media node from ${kindLabel} asset`}
                    title={`Create media node from ${kindLabel} asset`}
                  >
                    <PlusIcon width={11} height={11} />
                  </button>
                  <button
                    type="button"
                    className="ibtn"
                    onClick={() => onReplace(image.id)}
                    aria-label={`Replace ${kindLabel} asset`}
                    title={`Replace ${kindLabel} asset`}
                  >
                    <DownloadIcon width={11} height={11} />
                  </button>
                  <button
                    type="button"
                    className="ibtn ibtn--danger"
                    onClick={() => onRemove(image.id)}
                    disabled={!canRemove}
                    aria-label={`Remove ${kindLabel} asset`}
                    title={canRemove
                      ? `Remove ${kindLabel} asset`
                      : `${kindLabel === "video" ? "Video" : kindLabel === "sequence" ? "Sequence" : "Image"} asset is in use`}
                  >
                    <TrashIcon width={11} height={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
