import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ExportPanel } from "./ExportPanel";

describe("ExportPanel", () => {
  it("renders the preview and forwards user actions", async () => {
    const user = userEvent.setup();
    const onExportModeChange = vi.fn();
    const onCopy = vi.fn();
    const onDownload = vi.fn();

    render(
      <ExportPanel
        exportMode="typescript"
        preview={"export class HeroBanner {}"}
        onExportModeChange={onExportModeChange}
        onCopy={onCopy}
        onDownload={onDownload}
      />,
    );

    expect(screen.getByDisplayValue("export class HeroBanner {}")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Blueprint JSON" }));
    await user.click(screen.getByRole("button", { name: "Copy" }));
    await user.click(screen.getByRole("button", { name: "Download" }));

    expect(onExportModeChange).toHaveBeenCalledWith("json");
    expect(onCopy).toHaveBeenCalledTimes(1);
    expect(onDownload).toHaveBeenCalledTimes(1);
  });
});
