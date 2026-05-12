import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { createDefaultSceneSettings } from "../../state";
import { SettingsDialog } from "./SettingsDialog";

vi.mock("./HdrEnvironmentPreview", () => ({
  HdrEnvironmentPreview: () => <div data-testid="hdr-preview" />,
}));

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
        hdrAssets={[{
          id: "studio",
          name: "Studio.hdr",
          mimeType: "image/vnd.radiance",
          src: "data:image/vnd.radiance;base64,aGRy",
        }]}
        onImportHdr={vi.fn()}
        onChangeSceneSettings={handleChangeSceneSettings}
      />,
    );

    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "studio" } });
    fireEvent.change(screen.getByLabelText("Background"), { target: { value: "#111111" } });
    fireEvent.click(screen.getByRole("button", { name: "Linear" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Shadows" }));

    expect(handleChangeSceneSettings).toHaveBeenCalledWith({ environment: { type: "hdr", hdrAssetId: "studio" } });
    expect(handleChangeSceneSettings).toHaveBeenCalledWith({ backgroundColor: "#111111" });
    expect(handleChangeSceneSettings).toHaveBeenCalledWith({ toneMapping: { type: "linear" } });
    expect(handleChangeSceneSettings).toHaveBeenCalledWith({ shadows: { enabled: false } });
  });

  it("previews HDR settings locally and applies them on demand", () => {
    const handleChangeSceneSettings = vi.fn();

    render(
      <SettingsDialog
        isOpen
        onClose={vi.fn()}
        theme="dark"
        onChangeTheme={vi.fn()}
        sceneSettings={createDefaultSceneSettings()}
        hdrAssets={[{
          id: "studio",
          name: "Studio.hdr",
          mimeType: "image/vnd.radiance",
          src: "data:image/vnd.radiance;base64,aGRy",
        }]}
        onImportHdr={vi.fn()}
        onChangeSceneSettings={handleChangeSceneSettings}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "HDR Preview" }));
    expect(screen.getByTestId("hdr-preview")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Environment"), { target: { value: "studio" } });
    fireEvent.change(screen.getByLabelText("Env Intensity"), { target: { value: "1.8" } });
    fireEvent.change(screen.getByLabelText("Exposure"), { target: { value: "1.4" } });
    fireEvent.click(screen.getByRole("button", { name: "Linear" }));

    expect(handleChangeSceneSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Apply to Scene" }));

    expect(screen.getByRole("tab", { name: "HDR Preview" }).getAttribute("aria-selected")).toBe("true");
    expect(handleChangeSceneSettings).toHaveBeenCalledWith({
      environment: {
        type: "hdr",
        hdrAssetId: "studio",
        intensity: 1.8,
      },
      toneMapping: {
        type: "linear",
        exposure: 1.4,
      },
    });
  });

  it("keeps the HDR preview tab active when scene settings change after import", () => {
    const initialSceneSettings = createDefaultSceneSettings();
    const importedSceneSettings = {
      ...initialSceneSettings,
      environment: {
        type: "hdr" as const,
        hdrAssetId: "studio",
        intensity: 1,
      },
    };

    const { rerender } = render(
      <SettingsDialog
        isOpen
        onClose={vi.fn()}
        theme="dark"
        onChangeTheme={vi.fn()}
        sceneSettings={initialSceneSettings}
        hdrAssets={[]}
        onImportHdr={vi.fn()}
        onChangeSceneSettings={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("tab", { name: "HDR Preview" }));

    rerender(
      <SettingsDialog
        isOpen
        onClose={vi.fn()}
        theme="dark"
        onChangeTheme={vi.fn()}
        sceneSettings={importedSceneSettings}
        hdrAssets={[{
          id: "studio",
          name: "Studio.hdr",
          mimeType: "image/vnd.radiance",
          src: "data:image/vnd.radiance;base64,aGRy",
        }]}
        onImportHdr={vi.fn()}
        onChangeSceneSettings={vi.fn()}
      />,
    );

    expect(screen.getByRole("tab", { name: "HDR Preview" }).getAttribute("aria-selected")).toBe("true");
    expect((screen.getByLabelText("Environment") as HTMLSelectElement).value).toBe("studio");
  });
});
