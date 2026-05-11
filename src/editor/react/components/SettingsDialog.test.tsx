import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultSceneSettings } from "../../state";
import { SettingsDialog } from "./SettingsDialog";

describe("SettingsDialog", () => {
  it("edits scene settings when scene settings props are provided", () => {
    const handleChangeSceneSettings = vi.fn();

    render(
      <SettingsDialog
        isOpen
        onClose={vi.fn()}
        theme="dark"
        onChangeTheme={vi.fn()}
        sceneSettings={createDefaultSceneSettings()}
        onChangeSceneSettings={handleChangeSceneSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("Background"), { target: { value: "#111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Linear" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Shadows" }));

    expect(handleChangeSceneSettings).toHaveBeenCalledWith({ backgroundColor: "#111111" });
    expect(handleChangeSceneSettings).toHaveBeenCalledWith({ toneMapping: { type: "linear" } });
    expect(handleChangeSceneSettings).toHaveBeenCalledWith({ shadows: { enabled: false } });
  });
});
