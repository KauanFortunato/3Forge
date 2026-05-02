import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function Ico(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function LogoGlyph(props: IconProps) {
  // Brand mark — the sole filled icon (3F hexagon).
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...props}
    >
      <path d="M3 2h5.2L11 4.8V12H3V2Zm1.7 2.9v5.8h4.6V6L7.6 4.3H5.6l-.9.6Zm1.8 1.2h1.2v1.2H6.5V6.1Zm0 1.8h1.2V9.1H6.5V7.9Z" />
    </svg>
  );
}

export function UndoIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M2.4 6.2h6.2a3 3 0 0 1 0 6H5.2" />
      <path d="m4.6 4 -2.2 2.2 2.2 2.2" />
    </Ico>
  );
}

export function RedoIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M11.6 6.2H5.4a3 3 0 0 0 0 6h3.4" />
      <path d="m9.4 4 2.2 2.2-2.2 2.2" />
    </Ico>
  );
}

export function CursorIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="m2.4 2.4 4.2 9.9 1.5-4.3 4.3-1.5z" />
    </Ico>
  );
}

export function MoveIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M7 1.2v11.6M1.2 7h11.6" />
      <path d="m3.2 5 -1.8 2 1.8 2" />
      <path d="m10.8 5 1.8 2-1.8 2" />
      <path d="M5 3.2 7 1.4l2 1.8" />
      <path d="M5 10.8 7 12.6l2-1.8" />
    </Ico>
  );
}

export function RotateIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M12.3 7a5.3 5.3 0 1 1-5.3-5.3" />
      <path d="M12.3 1.8v3.5H8.8" />
    </Ico>
  );
}

export function ScaleIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M8 2.4h3.6V6" />
      <path d="M6 11.6H2.4V8" />
      <path d="m11.6 2.4 -4.1 4.1" />
      <path d="m2.4 11.6 4.1-4.1" />
    </Ico>
  );
}

export function FrameIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M2.4 4.8V2.4h2.4" />
      <path d="M9.2 2.4h2.4v2.4" />
      <path d="M11.6 9.2v2.4H9.2" />
      <path d="M4.8 11.6H2.4V9.2" />
      <circle cx="7" cy="7" r="1.5" />
    </Ico>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="m5.2 3.4 3.6 3.6-3.6 3.6" />
    </Ico>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="m3.4 5.2 3.6 3.6 3.6-3.6" />
    </Ico>
  );
}

export function StarIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="m7 1.6 1.66 3.37 3.72.54-2.69 2.62.63 3.71L7 10.08 3.68 11.84l.63-3.71L1.62 5.5l3.72-.54z" />
    </Ico>
  );
}

export function CircleIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="4" />
    </Ico>
  );
}

export function CircleFilledIcon(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      aria-hidden="true"
      {...props}
    >
      <circle cx="7" cy="7" r="4" />
    </svg>
  );
}

type KeyframeDiamondIconProps = IconProps & { filled?: boolean; animated?: boolean };

export function KeyframeDiamondIcon({ filled, animated, ...rest }: KeyframeDiamondIconProps) {
  if (filled) {
    return (
      <svg
        width={14}
        height={14}
        viewBox="0 0 14 14"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        <path d="M7 1.6 12.4 7 7 12.4 1.6 7Z" />
      </svg>
    );
  }
  return (
    <Ico
      strokeWidth={animated ? 1.6 : 1.3}
      {...rest}
    >
      <path d="M7 1.6 12.4 7 7 12.4 1.6 7Z" />
    </Ico>
  );
}

export function CodeBracketsIcon({ active, ...rest }: IconProps & { active?: boolean }) {
  return (
    <Ico
      strokeWidth={active ? 1.8 : 1.4}
      {...rest}
    >
      <path d="m4.6 4.6-2.6 2.4 2.6 2.4" />
      <path d="m9.4 4.6 2.6 2.4-2.6 2.4" />
    </Ico>
  );
}

export function FileIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M8.2 1.4H4a1.2 1.2 0 0 0-1.2 1.2v8.8A1.2 1.2 0 0 0 4 12.6h6a1.2 1.2 0 0 0 1.2-1.2V4.4z" />
      <path d="M8.2 1.4v3h3" />
    </Ico>
  );
}

export function ShortcutIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <rect x="1.2" y="3.6" width="11.6" height="6.8" rx="1.2" />
      <path d="M3.6 5.8h.01M5.6 5.8h.01M7.6 5.8h.01M9.6 5.8h.01M3.6 8.2h.01M9.6 8.2h.01M4.8 8.2h3.6" />
    </Ico>
  );
}

export function InfoIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="5.3" />
      <path d="M7 9.4V6.6M7 4.6h.01" />
    </Ico>
  );
}

export function CopyIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <rect x="5" y="5" width="7.8" height="7.8" rx="1.2" />
      <path d="M3 8.4h-.6A1.2 1.2 0 0 1 1.2 7.2V2.4A1.2 1.2 0 0 1 2.4 1.2h4.8a1.2 1.2 0 0 1 1.2 1.2V3" />
    </Ico>
  );
}

export function DownloadIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M7 1.8v7.2" />
      <path d="m4.6 6.6 2.4 2.4 2.4-2.4" />
      <path d="M11.8 12.2H2.2" />
    </Ico>
  );
}

export function TrashIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M1.8 3.6h10.4" />
      <path d="M11.2 3.6v8.2a1.2 1.2 0 0 1-1.2 1.2H4a1.2 1.2 0 0 1-1.2-1.2V3.6" />
      <path d="M4.8 3.6V2.4a1.2 1.2 0 0 1 1.2-1.2h2a1.2 1.2 0 0 1 1.2 1.2v1.2" />
    </Ico>
  );
}

export function GroupIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="m7 1.4 5.8 2.9L7 7.2 1.2 4.3z" />
      <path d="m1.2 9.7 5.8 2.9 5.8-2.9" />
      <path d="m1.2 7 5.8 2.9L12.8 7" />
    </Ico>
  );
}

export function MeshIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M12.2 9.4V4.6a1.2 1.2 0 0 0-.6-1.04l-4.2-2.4a1.2 1.2 0 0 0-1.2 0l-4.2 2.4A1.2 1.2 0 0 0 1.4 4.6v4.8a1.2 1.2 0 0 0 .6 1.04l4.2 2.4a1.2 1.2 0 0 0 1.2 0l4.2-2.4a1.2 1.2 0 0 0 .6-1.04z" />
      <path d="m1.56 4.18 5.44 3.16 5.44-3.16" />
      <path d="M7 13.24V7.34" />
    </Ico>
  );
}

export function TransformIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M7 1.2v11.6M1.2 7h11.6" />
      <path d="m3.2 5 -1.8 2 1.8 2" />
      <path d="m10.8 5 1.8 2-1.8 2" />
      <path d="M5 3.2 7 1.4l2 1.8" />
      <path d="M5 10.8 7 12.6l2-1.8" />
    </Ico>
  );
}

export function GeometryIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M12.2 9.4V4.6a1.2 1.2 0 0 0-.6-1.04l-4.2-2.4a1.2 1.2 0 0 0-1.2 0l-4.2 2.4A1.2 1.2 0 0 0 1.4 4.6v4.8a1.2 1.2 0 0 0 .6 1.04l4.2 2.4a1.2 1.2 0 0 0 1.2 0l4.2-2.4a1.2 1.2 0 0 0 .6-1.04z" />
      <path d="m1.56 4.18 5.44 3.16 5.44-3.16" />
      <path d="M7 13.24V7.34" />
    </Ico>
  );
}

export function MaterialIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="8" cy="3.8" r="0.3" fill="currentColor" />
      <circle cx="10.3" cy="6.1" r="0.3" fill="currentColor" />
      <circle cx="5" cy="4.4" r="0.3" fill="currentColor" />
      <circle cx="3.8" cy="7.3" r="0.3" fill="currentColor" />
      <path d="M7 1.2a5.8 5.8 0 1 0 0 11.6 1.45 1.45 0 0 0 1.45-1.45 1.45 1.45 0 0 1 1.45-1.45h.87a2.03 2.03 0 0 0 2.03-2.03A5.8 5.8 0 0 0 7 1.2Z" />
    </Ico>
  );
}

export function TextPropertyIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M2.4 3.4V2.4h9.2v1" />
      <path d="M5.2 11.6h3.6" />
      <path d="M7 2.4v9.2" />
    </Ico>
  );
}

export function ImagePropertyIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <rect x="1.8" y="1.8" width="10.4" height="10.4" rx="1.2" />
      <circle cx="5.2" cy="5.2" r="1.1" />
      <path d="m12.2 8.6 -2.9-2.9-6.3 6.5" />
    </Ico>
  );
}

export function ObjectDataIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="1.6" />
      <path d="M11.1 8.6a.96.96 0 0 0 .19 1.06l.04.04a1.16 1.16 0 1 1-1.65 1.65l-.04-.04a.96.96 0 0 0-1.06-.19.96.96 0 0 0-.58.88v.11a1.16 1.16 0 0 1-2.32 0v-.06a.96.96 0 0 0-.63-.88.96.96 0 0 0-1.06.19l-.04.04a1.16 1.16 0 1 1-1.65-1.65l.04-.04a.96.96 0 0 0 .19-1.06.96.96 0 0 0-.88-.58h-.06a1.16 1.16 0 1 1 0-2.32h.06a.96.96 0 0 0 .88-.58.96.96 0 0 0-.19-1.06l-.04-.04a1.16 1.16 0 1 1 1.65-1.65l.04.04a.96.96 0 0 0 1.06.19h.05a.96.96 0 0 0 .58-.88v-.06a1.16 1.16 0 1 1 2.32 0v.06a.96.96 0 0 0 .58.88.96.96 0 0 0 1.06-.19l.04-.04a1.16 1.16 0 1 1 1.65 1.65l-.04.04a.96.96 0 0 0-.19 1.06v.05a.96.96 0 0 0 .88.58h.11a1.16 1.16 0 1 1 0 2.32h-.06a.96.96 0 0 0-.88.58z" />
    </Ico>
  );
}

export function ViewSolidIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="5" />
    </Ico>
  );
}

export function ViewRenderedIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="5" />
      <path d="M7 2a5 5 0 0 1 0 10z" fill="currentColor" stroke="none" />
    </Ico>
  );
}

export function BoxIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M12.2 9.4V4.6a1.2 1.2 0 0 0-.6-1.04l-4.2-2.4a1.2 1.2 0 0 0-1.2 0l-4.2 2.4A1.2 1.2 0 0 0 1.4 4.6v4.8a1.2 1.2 0 0 0 .6 1.04l4.2 2.4a1.2 1.2 0 0 0 1.2 0l4.2-2.4a1.2 1.2 0 0 0 .6-1.04z" />
      <path d="m1.56 4.18 5.44 3.16 5.44-3.16" />
      <path d="M7 13.24V7.34" />
    </Ico>
  );
}

export function SphereIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="5.3" />
      <path d="M1.7 7h10.6" />
      <path d="M7 1.7a7.6 7.6 0 0 1 0 10.6" />
      <path d="M7 1.7a7.6 7.6 0 0 0 0 10.6" />
    </Ico>
  );
}

export function CylinderIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <ellipse cx="7" cy="3" rx="4.6" ry="1.5" />
      <path d="M2.4 3v8a4.6 1.5 0 0 0 9.2 0V3" />
    </Ico>
  );
}

export function PlaneIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M1.6 10.6h10.8" />
      <path d="m2.8 10.6 1.8-5.2h4.8l1.8 5.2" />
    </Ico>
  );
}

export function ImageIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <rect x="1.8" y="1.8" width="10.4" height="10.4" rx="1.2" />
      <circle cx="5.2" cy="5.2" r="1.1" />
      <path d="m12.2 8.6 -2.9-2.9-6.3 6.5" />
    </Ico>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M1.2 7s2-4 5.8-4 5.8 4 5.8 4-2 4-5.8 4S1.2 7 1.2 7Z" />
      <circle cx="7" cy="7" r="1.75" />
    </Ico>
  );
}

export function ClosedEyeIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="m1.8 1.8 10.4 10.4" />
      <path d="M6.1 3.1A6.2 6.2 0 0 1 7 3c3.8 0 5.8 4 5.8 4a11.7 11.7 0 0 1-1.75 2.33" />
      <path d="M3.8 3.8A11.5 11.5 0 0 0 1.2 7s2 4 5.8 4a5.8 5.8 0 0 0 3.1-.93" />
      <path d="M5.25 5.25a1.75 1.75 0 0 0 2.92 2.92" />
    </Ico>
  );
}

export function TimelineIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="5.3" />
      <path d="M7 4.1V7l1.75 1.15" />
    </Ico>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M2.4 7h9.2" />
      <path d="M7 2.4v9.2" />
    </Ico>
  );
}

export function XIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="m3.6 3.6 6.8 6.8" />
      <path d="m10.4 3.6-6.8 6.8" />
    </Ico>
  );
}

export function AssignIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M7 1.7v6.9" />
      <path d="m4.4 6 2.6 2.6L9.6 6" />
      <path d="M2.4 9.5v1.4a1.2 1.2 0 0 0 1.2 1.2h6.8a1.2 1.2 0 0 0 1.2-1.2V9.5" />
    </Ico>
  );
}

export function UnlinkIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M5.6 6.4 2.8 9.2a1.8 1.8 0 0 0 2.55 2.55L7 10.1" />
      <path d="m8.4 7.6 2.8-2.8a1.8 1.8 0 0 0-2.55-2.55L7 3.9" />
      <path d="M9.6 1.6V3" />
      <path d="M11.4 3.6h1.4" />
      <path d="M4.4 12.4V11" />
      <path d="M1.2 10.4h1.4" />
    </Ico>
  );
}

export function SaveIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M11.1 12.2H2.9a1.2 1.2 0 0 1-1.2-1.2V3a1.2 1.2 0 0 1 1.2-1.2H9.4l2.9 2.9V11a1.2 1.2 0 0 1-1.2 1.2z" />
      <path d="M9.9 12.2V7.5H4.1v4.7" />
      <path d="M4.1 1.8v2.9h4.7" />
    </Ico>
  );
}

export function HelpIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="5.3" />
      <path d="M5.5 5.5a1.5 1.5 0 1 1 2.1 1.4c-.5.2-.85.55-.85 1.1v.25" />
      <path d="M7 10.4h.01" />
    </Ico>
  );
}

export function SearchIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="6.2" cy="6.2" r="4" />
      <path d="m12.2 12.2 -3-3" />
    </Ico>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M4 2.6v8.8l7-4.4z" />
    </svg>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...props}
    >
      <rect x="3.6" y="2.6" width="2.4" height="8.8" rx="0.4" />
      <rect x="8" y="2.6" width="2.4" height="8.8" rx="0.4" />
    </svg>
  );
}

export function StopIcon(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      stroke="none"
      aria-hidden="true"
      {...props}
    >
      <rect x="3.4" y="3.4" width="7.2" height="7.2" rx="0.6" />
    </svg>
  );
}

export function SkipBackIcon(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M11.2 11.4 5.4 7l5.8-4.4z" />
      <path d="M3 11V3" fill="none" />
    </svg>
  );
}

export function SkipForwardIcon(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M2.8 2.6 8.6 7l-5.8 4.4z" />
      <path d="M11 3v8" fill="none" />
    </svg>
  );
}

export function RewindIcon(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M6.6 11.2 1.6 7l5-4.2z" />
      <path d="M12.4 11.2 7.4 7l5-4.2z" />
    </svg>
  );
}

export function FastForwardIcon(props: IconProps) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 14 14"
      fill="currentColor"
      stroke="currentColor"
      strokeWidth="1"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M1.6 2.8 6.6 7 1.6 11.2z" />
      <path d="M7.4 2.8 12.4 7 7.4 11.2z" />
    </svg>
  );
}

export function ExportIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <path d="M7 1.8v7.8" />
      <path d="m4.4 4.4 2.6-2.6 2.6 2.6" />
      <path d="M2.2 9.4v1.8a1.2 1.2 0 0 0 1.2 1.2h7.2a1.2 1.2 0 0 0 1.2-1.2V9.4" />
    </Ico>
  );
}

export function SettingsIcon(props: IconProps) {
  return (
    <Ico {...props}>
      <circle cx="7" cy="7" r="1.8" />
      <path d="M7 1.4v1.4M7 11.2v1.4M2.4 7H1M13 7h-1.4M3.74 3.74l-.99-.99M11.25 11.25l-.99-.99M3.74 10.26l-.99.99M11.25 2.75l-.99.99" />
    </Ico>
  );
}
