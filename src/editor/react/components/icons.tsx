import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

function BootstrapIcon(props: IconProps) {
  const { children, ...rest } = props;
  return (
    <svg
      viewBox="0 0 16 16"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...rest}
    >
      <g transform="translate(1.2, 1.2) scale(0.85)">
        {children}
      </g>
    </svg>
  );
}

export function LogoGlyph(props: IconProps) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
      <path d="M12 2 4 6.5v11L12 22l8-4.5v-11L12 2Z" fill="currentColor" opacity="0.15" />
      <path d="M12 3.8 5.6 7.3v9.4L12 20.2l6.4-3.5V7.3L12 3.8Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 3.8v16.4M5.6 7.3 12 11l6.4-3.7" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z" />
      <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466" />
    </BootstrapIcon>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z" />
      <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466" />
    </BootstrapIcon>
  );
}

export function CursorIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103zM2.25 8.184l3.897 1.67a.5.5 0 0 1 .262.263l1.67 3.897L12.743 3.52z" />
    </BootstrapIcon>
  );
}

export function MoveIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path fillRule="evenodd" d="M7.646.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 1.707V5.5a.5.5 0 0 1-1 0V1.707L6.354 2.854a.5.5 0 1 1-.708-.708zM8 10a.5.5 0 0 1 .5.5v3.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 14.293V10.5A.5.5 0 0 1 8 10M.146 8.354a.5.5 0 0 1 0-.708l2-2a.5.5 0 1 1 .708.708L1.707 7.5H5.5a.5.5 0 0 1 0 1H1.707l1.147 1.146a.5.5 0 0 1-.708.708zM10 8a.5.5 0 0 1 .5-.5h3.793l-1.147-1.146a.5.5 0 0 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L14.293 8.5H10.5A.5.5 0 0 1 10 8" />
    </BootstrapIcon>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9" />
      <path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z" />
    </BootstrapIcon>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 16 16 4" />
      <path d="M4 8V4h4" />
      <path d="M12 16h4v-4" />
      <circle cx="4" cy="16" r="1.5" />
      <circle cx="16" cy="4" r="1.5" />
    </BaseIcon>
  );
}

export function FrameIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 8V4h4M12 4h4v4M16 12v4h-4M8 16H4v-4" />
      <rect x="7" y="7" width="6" height="6" rx="1" />
    </BaseIcon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m8 5 5 5-5 5" />
    </BaseIcon>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m5 8 5 5 5-5" />
    </BaseIcon>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M2.866 14.85c-.078.444.36.791.746.593l4.39-2.256 4.389 2.256c.386.198.824-.149.746-.592l-.83-4.73 3.522-3.356c.33-.314.16-.888-.282-.95l-4.898-.696L8.465.792a.513.513 0 0 0-.927 0L5.354 5.12l-4.898.696c-.441.062-.612.636-.283.95l3.523 3.356-.83 4.73zm4.905-2.767-3.686 1.894.694-3.957a.565.565 0 0 0-.163-.505L1.71 6.745l4.052-.576a.525.525 0 0 0 .393-.288L8 2.223l1.847 3.658a.525.525 0 0 0 .393.288l4.052.575-2.906 2.77a.565.565 0 0 0-.163.506l.694 3.957-3.686-1.894a.503.503 0 0 0-.461 0z" />
    </BootstrapIcon>
  );
}

export function CircleIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="6" />
    </svg>
  );
}

export function CircleFilledIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M14 4.5V14a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V2a2 2 0 0 1 2-2h5.5zm-3 0A1.5 1.5 0 0 1 9.5 3V1H4a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V4.5z" />
    </BootstrapIcon>
  );
}

export function ShortcutIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path fill-rule="evenodd" d="M6.364 13.5a.5.5 0 0 0 .5.5H13.5a1.5 1.5 0 0 0 1.5-1.5v-10A1.5 1.5 0 0 0 13.5 1h-10A1.5 1.5 0 0 0 2 2.5v6.636a.5.5 0 1 0 1 0V2.5a.5.5 0 0 1 .5-.5h10a.5.5 0 0 1 .5.5v10a.5.5 0 0 1-.5.5H6.864a.5.5 0 0 0-.5.5" />
      <path fill-rule="evenodd" d="M11 5.5a.5.5 0 0 0-.5-.5h-5a.5.5 0 0 0 0 1h3.793l-8.147 8.146a.5.5 0 0 0 .708.708L10 6.707V10.5a.5.5 0 0 0 1 0z" />
    </BootstrapIcon>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="10" cy="10" r="7" />
      <path d="M10 9.2v4.1" />
      <path d="M10 6.4h.01" />
    </BaseIcon>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="7" y="7" width="9" height="10" rx="1.5" />
      <path d="M5 13H4a1 1 0 0 1-1-1V4.5A1.5 1.5 0 0 1 4.5 3H11a1 1 0 0 1 1 1v1" />
    </BaseIcon>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M.5 9.9a.5.5 0 0 1 .5.5v2.5a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-2.5a.5.5 0 0 1 1 0v2.5a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2v-2.5a.5.5 0 0 1 .5-.5" />
      <path d="M7.646 11.854a.5.5 0 0 0 .708 0l3-3a.5.5 0 0 0-.708-.708L8.5 10.293V1.5a.5.5 0 0 0-1 0v8.793L5.354 8.146a.5.5 0 1 0-.708.708z" />
    </BootstrapIcon>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 6h12" />
      <path d="M7 6V4.6A1.6 1.6 0 0 1 8.6 3h2.8A1.6 1.6 0 0 1 13 4.6V6" />
      <path d="M6 6v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V6" />
      <path d="M8.5 9.2v4.2M11.5 9.2v4.2" />
    </BaseIcon>
  );
}

export function GroupIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 5.5h5.5v4H3z" />
      <path d="M11.5 5.5H17v4h-5.5z" />
      <path d="M7.2 12H12.8v4.5H7.2z" />
      <path d="M5.8 9.5v1.4m8.4-1.4v1.4M10 10.9V12" />
    </BaseIcon>
  );
}

export function MeshIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M8.186 1.113a.5.5 0 0 0-.372 0L1.846 3.5 8 5.961 14.154 3.5zM15 4.239l-6.5 2.6v7.922l6.5-2.6V4.24zM7.5 14.762V6.838L1 4.239v7.923zM7.443.184a1.5 1.5 0 0 1 1.114 0l7.129 2.852A.5.5 0 0 1 16 3.5v8.662a1 1 0 0 1-.629.928l-7.185 2.874a.5.5 0 0 1-.372 0L.63 13.09a1 1 0 0 1-.63-.928V3.5a.5.5 0 0 1 .314-.464z" />
    </BaseIcon>
  );
}

export function TransformIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path fill-rule="evenodd" d="M7.646.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 1.707V5.5a.5.5 0 0 1-1 0V1.707L6.354 2.854a.5.5 0 1 1-.708-.708zM8 10a.5.5 0 0 1 .5.5v3.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 14.293V10.5A.5.5 0 0 1 8 10M.146 8.354a.5.5 0 0 1 0-.708l2-2a.5.5 0 1 1 .708.708L1.707 7.5H5.5a.5.5 0 0 1 0 1H1.707l1.147 1.146a.5.5 0 0 1-.708.708zM10 8a.5.5 0 0 1 .5-.5h3.793l-1.147-1.146a.5.5 0 0 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L14.293 8.5H10.5A.5.5 0 0 1 10 8" />
    </BootstrapIcon>
  );
}

export function GeometryIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M5 2V0H0v5h2v6H0v5h5v-2h6v2h5v-5h-2V5h2V0h-5v2zm6 1v2h2v6h-2v2H5v-2H3V5h2V3zm1-2h3v3h-3zm3 11v3h-3v-3zM4 15H1v-3h3zM1 4V1h3v3z" />
    </BootstrapIcon>
  );
}

export function MaterialIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path fill-rule="evenodd" d="M7.21.8C7.69.295 8 0 8 0q.164.544.371 1.038c.812 1.946 2.073 3.35 3.197 4.6C12.878 7.096 14 8.345 14 10a6 6 0 0 1-12 0C2 6.668 5.58 2.517 7.21.8m.413 1.021A31 31 0 0 0 5.794 3.99c-.726.95-1.436 2.008-1.96 3.07C3.304 8.133 3 9.138 3 10c0 0 2.5 1.5 5 .5s5-.5 5-.5c0-1.201-.796-2.157-2.181-3.7l-.03-.032C9.75 5.11 8.5 3.72 7.623 1.82z" />
      <path fill-rule="evenodd" d="M4.553 7.776c.82-1.641 1.717-2.753 2.093-3.13l.708.708c-.29.29-1.128 1.311-1.907 2.87z" />
    </BootstrapIcon>
  );
}

export function TextPropertyIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M12.258 3h-8.51l-.083 2.46h.479c.26-1.544.758-1.783 2.693-1.845l.424-.013v7.827c0 .663-.144.82-1.3.923v.52h4.082v-.52c-1.162-.103-1.306-.26-1.306-.923V3.602l.431.013c1.934.062 2.434.301 2.693 1.846h.479z" />
    </BootstrapIcon>
  );
}

export function ImagePropertyIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="4" width="14" height="12" rx="1.6" />
      <circle cx="7.3" cy="8" r="1.1" />
      <path d="m5 14 3.2-3.2 2.4 2.4 2.3-2.3L15 14" />
    </BaseIcon>
  );
}

export function ObjectDataIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M5 10.5a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 0 1h-2a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5m0-2a.5.5 0 0 1 .5-.5h5a.5.5 0 0 1 0 1h-5a.5.5 0 0 1-.5-.5" />
      <path d="M3 0h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2v-1h1v1a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V2a1 1 0 0 0-1-1H3a1 1 0 0 0-1 1v1H1V2a2 2 0 0 1 2-2" />
      <path d="M1 5v-.5a.5.5 0 0 1 1 0V5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0V8h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1zm0 3v-.5a.5.5 0 0 1 1 0v.5h.5a.5.5 0 0 1 0 1h-2a.5.5 0 0 1 0-1z" />
    </BootstrapIcon>
  );
}

export function ViewSolidIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
    </BootstrapIcon>
  );
}

export function ViewRenderedIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M8 15A7 7 0 1 0 8 1zm0 1A8 8 0 1 1 8 0a8 8 0 0 1 0 16" />
    </BootstrapIcon>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M8.186 1.113a.5.5 0 0 0-.372 0L1.846 3.5 8 5.961 14.154 3.5zM15 4.239l-6.5 2.6v7.922l6.5-2.6V4.24zM7.5 14.762V6.838L1 4.239v7.923zM7.443.184a1.5 1.5 0 0 1 1.114 0l7.129 2.852A.5.5 0 0 1 16 3.5v8.662a1 1 0 0 1-.629.928l-7.185 2.874a.5.5 0 0 1-.372 0L.63 13.09a1 1 0 0 1-.63-.928V3.5a.5.5 0 0 1 .314-.464z" />
    </BootstrapIcon>
  );
}

export function SphereIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
    </BootstrapIcon>
  );
}

export function CylinderIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
    </BootstrapIcon>
  );
}

export function PlaneIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16" />
    </BootstrapIcon>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M6.002 5.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0" />
      <path d="M1.5 2A1.5 1.5 0 0 0 0 3.5v9A1.5 1.5 0 0 0 1.5 14h13a1.5 1.5 0 0 0 1.5-1.5v-9A1.5 1.5 0 0 0 14.5 2zm13 1a.5.5 0 0 1 .5.5v6l-3.775-1.947a.5.5 0 0 0-.577.093l-3.71 3.71-2.66-1.772a.5.5 0 0 0-.63.062L1.002 12v.54L1 12.5v-9a.5.5 0 0 1 .5-.5z" />
    </BootstrapIcon>
  );
}