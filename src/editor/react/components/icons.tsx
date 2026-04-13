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
      style={{ padding: "2px" }}
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
      <path fill-rule="evenodd" d="M8 3a5 5 0 1 1-4.546 2.914.5.5 0 0 0-.908-.417A6 6 0 1 0 8 2z"/>
      <path d="M8 4.466V.534a.25.25 0 0 0-.41-.192L5.23 2.308a.25.25 0 0 0 0 .384l2.36 1.966A.25.25 0 0 0 8 4.466"/>
    </BootstrapIcon>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path fill-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2z"/>
      <path d="M8 4.466V.534a.25.25 0 0 1 .41-.192l2.36 1.966c.12.1.12.284 0 .384L8.41 4.658A.25.25 0 0 1 8 4.466"/>
    </BootstrapIcon>
  );
}

export function CursorIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M14.082 2.182a.5.5 0 0 1 .103.557L8.528 15.467a.5.5 0 0 1-.917-.007L5.57 10.694.803 8.652a.5.5 0 0 1-.006-.916l12.728-5.657a.5.5 0 0 1 .556.103zM2.25 8.184l3.897 1.67a.5.5 0 0 1 .262.263l1.67 3.897L12.743 3.52z"/>
    </BootstrapIcon>
  );
}

export function MoveIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path fillRule="evenodd" d="M7.646.146a.5.5 0 0 1 .708 0l2 2a.5.5 0 0 1-.708.708L8.5 1.707V5.5a.5.5 0 0 1-1 0V1.707L6.354 2.854a.5.5 0 1 1-.708-.708zM8 10a.5.5 0 0 1 .5.5v3.793l1.146-1.147a.5.5 0 0 1 .708.708l-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 0 1 .708-.708L7.5 14.293V10.5A.5.5 0 0 1 8 10M.146 8.354a.5.5 0 0 1 0-.708l2-2a.5.5 0 1 1 .708.708L1.707 7.5H5.5a.5.5 0 0 1 0 1H1.707l1.147 1.146a.5.5 0 0 1-.708.708zM10 8a.5.5 0 0 1 .5-.5h3.793l-1.147-1.146a.5.5 0 0 1 .708-.708l2 2a.5.5 0 0 1 0 .708l-2 2a.5.5 0 0 1-.708-.708L14.293 8.5H10.5A.5.5 0 0 1 10 8"/>
    </BootstrapIcon>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <BootstrapIcon {...props}>
      <path d="M11.534 7h3.932a.25.25 0 0 1 .192.41l-1.966 2.36a.25.25 0 0 1-.384 0l-1.966-2.36a.25.25 0 0 1 .192-.41m-11 2h3.932a.25.25 0 0 0 .192-.41L2.692 6.23a.25.25 0 0 0-.384 0L.342 8.59A.25.25 0 0 0 .534 9"/>
      <path fill-rule="evenodd" d="M8 3c-1.552 0-2.94.707-3.857 1.818a.5.5 0 1 1-.771-.636A6.002 6.002 0 0 1 13.917 7H12.9A5 5 0 0 0 8 3M3.1 9a5.002 5.002 0 0 0 8.757 2.182.5.5 0 1 1 .771.636A6.002 6.002 0 0 1 2.083 9z"/>
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

export function FileIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M6 2.8h5.5L16.8 8v9.2H6z" />
      <path d="M11.5 2.8V8h5.3" />
    </BaseIcon>
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
      <path d="M10 2.6 3.5 6.2v7.6L10 17.4l6.5-3.6V6.2Z" />
      <path d="M10 2.6v14.8M3.5 6.2 10 10l6.5-3.8" />
    </BaseIcon>
  );
}

export function TransformIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M10 2.5v15" />
      <path d="M6.5 6 10 2.5 13.5 6" />
      <path d="M6.5 14 10 17.5 13.5 14" />
      <path d="M2.5 10h15" />
      <path d="M6 6.5 2.5 10 6 13.5" />
      <path d="M14 6.5 17.5 10 14 13.5" />
    </BaseIcon>
  );
}

export function GeometryIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 5h12v10H4z" />
      <path d="M4 5 10 2l6 3" />
      <path d="M10 2v13" />
    </BaseIcon>
  );
}

export function MaterialIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M10 2.8c2.5 2.9 4.8 5.3 4.8 7.6A4.8 4.8 0 0 1 5.2 10.4c0-2.3 2.3-4.7 4.8-7.6Z" />
      <path d="M7.2 11.5c.5 1 1.6 1.7 2.8 1.7 1.2 0 2.3-.7 2.8-1.7" />
    </BaseIcon>
  );
}

export function TextPropertyIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M4 4h12" />
      <path d="M10 4v12" />
      <path d="M6.5 16h7" />
    </BaseIcon>
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
    <BaseIcon {...props}>
      <rect x="4" y="4" width="12" height="12" rx="1.8" />
      <path d="M7 7.4h6M7 10h6M7 12.6h3.8" />
    </BaseIcon>
  );
}
