import { useEffect, useRef, useState } from "react";
import type { MenuAction } from "../ui-types";
import { MenuList } from "./ContextMenu";

const APP_LOGO_SRC = "/assets/web/logo.svg";

interface TopMenu {
  id: string;
  label: string;
  items: MenuAction[];
}

interface MenuBarProps {
  menus: TopMenu[];
}

export function MenuBar({ menus }: MenuBarProps) {
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
    <div ref={rootRef} className="menu-bar">
      <div className="menu-bar__brand" aria-label="3Forge">
        <img src={APP_LOGO_SRC} alt="" className="menu-bar__brand-image" />
      </div>

      <div className="menu-bar__menus">
        {menus.map((menu) => {
          const isOpen = openMenuId === menu.id;
          return (
            <div
              key={menu.id}
              className="menu-bar__menu"
              onMouseEnter={() => {
                if (openMenuId) {
                  setOpenMenuId(menu.id);
                }
              }}
            >
              <button
                type="button"
                className={`menu-bar__button${isOpen ? " is-open" : ""}`}
                onClick={() => setOpenMenuId((current) => (current === menu.id ? null : menu.id))}
              >
                {menu.label}
              </button>

              {isOpen ? (
                <div className="menu-bar__dropdown">
                  <MenuList items={menu.items} onClose={() => setOpenMenuId(null)} />
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
