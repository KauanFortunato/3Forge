import type { MouseEvent } from "react";
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

  const stop = (event: MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <div className="image-assets-panel">
      <div className="image-assets-panel__head">
        <span>Images</span>
        <div className="image-assets-panel__head-actions">
          <button
            type="button"
            className="ibtn"
            onClick={onImport}
            aria-label="Import image asset"
            title="Import image asset"
          >
            <PlusIcon width={11} height={11} />
          </button>
        </div>
      </div>

      {images.length === 0 ? (
        <div className="panel__empty">
          No reusable images yet. Import an image asset to place it in the scene.
        </div>
      ) : (
        <div className="image-assets-panel__list">
          {images.map((image) => {
            const usage = usageById[image.id] ?? 0;
            const isActive = image.id === selectedImageId;
            const canApply = selectedImageNodeCount > 0;
            const canRemove = canRemoveImage(image.id);

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
                    <img src={image.src} alt="" />
                  </span>
                  <span className="image-assets-panel__meta">
                    <span className="image-assets-panel__name">{image.name}</span>
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
                    aria-label="Apply image asset to selected image nodes"
                    title={canApply
                      ? "Apply to selected image nodes"
                      : "Select an image node to apply this asset"}
                  >
                    <AssignIcon width={11} height={11} />
                  </button>
                  <button
                    type="button"
                    className="ibtn"
                    onClick={() => onCreateNode(image)}
                    aria-label="Create image node from asset"
                    title="Create image node from asset"
                  >
                    <PlusIcon width={11} height={11} />
                  </button>
                  <button
                    type="button"
                    className="ibtn"
                    onClick={() => onReplace(image.id)}
                    aria-label="Replace image asset"
                    title="Replace image asset"
                  >
                    <DownloadIcon width={11} height={11} />
                  </button>
                  <button
                    type="button"
                    className="ibtn ibtn--danger"
                    onClick={() => onRemove(image.id)}
                    disabled={!canRemove}
                    aria-label="Remove image asset"
                    title={canRemove
                      ? "Remove image asset"
                      : "Image asset is in use"}
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
