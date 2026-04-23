import { useEffect, useRef, useState } from "react";
import type { MenuAction } from "../ui-types";
import { MenuList } from "./ContextMenu";

interface TopMenu {
  id: string;
  label: string;
  items: MenuAction[];
}

interface MenuBarProps {
  menus: TopMenu[];
  appVersion?: string;
}

export function MenuBar({ menus, appVersion }: MenuBarProps) {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpenMenuId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <div ref={rootRef} className="menubar">
      <div className="menubar__brand" aria-label="3Forge">
        <div className="menubar__brand-mark" aria-hidden="true">3F</div>
        <span>3Forge</span>
      </div>
      <div className="menubar__sep" aria-hidden="true" />

      <div className="menubar__menus">
        {menus.map((menu) => {
          const isOpen = openMenuId === menu.id;
          return (
            <div
              key={menu.id}
              className="menubar__menu"
              onMouseEnter={() => {
                if (openMenuId) {
                  setOpenMenuId(menu.id);
                }
              }}
            >
              <button
                type="button"
                className={`menubar__item${isOpen ? " is-active" : ""}`}
                onClick={() => setOpenMenuId((current) => (current === menu.id ? null : menu.id))}
              >
                {menu.label}
              </button>

              {isOpen ? (
                <div className="menu-popover">
                  <MenuList items={menu.items} onClose={() => setOpenMenuId(null)} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <div className="menubar__spacer" />

      {appVersion ? (
        <div className="menubar__right">
          <span className="menubar__chip">
            <span className="menubar__dot" aria-hidden="true" />
            auto-save
          </span>
          <span className="menubar__chip">{appVersion}</span>
        </div>
      ) : null}
    </div>
  );
}
