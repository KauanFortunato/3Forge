import { useState } from "react";
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

  const stop = (event: MouseEvent) => {
    event.stopPropagation();
  };

  const markLoaded = (id: string, src: string) => {
    setLoadedSrcById((prev) => (prev[id] === src ? prev : { ...prev, [id]: src }));
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
            const isVideo = isVideoMimeType(image.mimeType);
            const kindLabel = isVideo ? "video" : "image";

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
                  <span className="image-assets-panel__meta">
                    <span className="image-assets-panel__name">
                      {image.name}
                      {isVideo ? <span className="image-assets-panel__badge">VIDEO</span> : null}
                    </span>
                    <span className="image-assets-panel__sub">
                      {image.width} x {image.height}px - {usage} use{usage === 1 ? "" : "s"}
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
                      : `${kindLabel === "video" ? "Video" : "Image"} asset is in use`}
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
