import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MovConversionModal } from "./MovConversionModal";
import type { MovClassification } from "../../import/w3dFolder";

const NO_SEQ: MovClassification = {
  withSequence: [],
  withoutSequence: [
    { videoName: "PITCH_IN.mov" },
    { videoName: "PITCH_OUT.mov" },
  ],
};

describe("MovConversionModal", () => {
  it("does not render when classification has no .mov without sequence", () => {
    render(
      <MovConversionModal
        isOpen
        classification={{ withSequence: [], withoutSequence: [] }}
        projectName="GameName_FS"
        isDevMode
        onConvert={vi.fn()}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByText(/MOV videos detected/i)).toBeNull();
  });

  it("lists each .mov with a 'no sequence' badge", () => {
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} projectName="GameName_FS" isDevMode
        onConvert={vi.fn()} onImportWithoutConverting={vi.fn()} onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText("PITCH_IN.mov")).toBeInTheDocument();
    expect(screen.getByText("PITCH_OUT.mov")).toBeInTheDocument();
    expect(screen.getAllByText(/no sequence/i).length).toBe(2);
  });

  it("dev mode: clicking 'Convert and Import' calls onConvert with projectName", () => {
    const onConvert = vi.fn();
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} projectName="GameName_FS" isDevMode
        onConvert={onConvert} onImportWithoutConverting={vi.fn()} onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /convert and import/i }));
    expect(onConvert).toHaveBeenCalledWith({ projectName: "GameName_FS" });
  });

  it("build mode: 'Convert and Import' shows the CLI command + Copy button", () => {
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} projectName="GameName_FS" isDevMode={false}
        onConvert={vi.fn()} onImportWithoutConverting={vi.fn()} onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /convert and import/i }));
    expect(screen.getByText(/node scripts\/convert-w3d-mov-to-sequence\.mjs/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /copy command/i })).toBeInTheDocument();
  });

  it("'Import Without Converting' calls onImportWithoutConverting", () => {
    const cb = vi.fn();
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} projectName="GameName_FS" isDevMode
        onConvert={vi.fn()} onImportWithoutConverting={cb} onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /import without converting/i }));
    expect(cb).toHaveBeenCalled();
  });

  it("Cancel calls onCancel", () => {
    const cb = vi.fn();
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} projectName="GameName_FS" isDevMode
        onConvert={vi.fn()} onImportWithoutConverting={vi.fn()} onCancel={cb}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(cb).toHaveBeenCalled();
  });

  it("renders three groups (converted/skipped/failed) when conversionResult is set", () => {
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} projectName="GameName_FS" isDevMode
        onConvert={vi.fn()} onImportWithoutConverting={vi.fn()} onCancel={vi.fn()}
        conversionResult={{
          converted: ["A.mov"], skipped: ["B.mov"],
          failed: [{ filename: "C.mov", error: "ffmpeg exited with code 1" }],
          sequenceJsonPaths: [], warnings: [],
        }}
      />,
    );
    expect(screen.getByText(/converted/i)).toBeInTheDocument();
    expect(screen.getByText(/skipped/i)).toBeInTheDocument();
    expect(screen.getByText(/failed/i)).toBeInTheDocument();
    expect(screen.getByText(/ffmpeg exited with code 1/)).toBeInTheDocument();
  });

  it("renders an em-dash separator between each filename and its badge", () => {
    render(
      <MovConversionModal
        isOpen
        classification={{
          withSequence: [{ videoName: "ALREADY_DONE.mov", sequencePath: "x/ALREADY_DONE_frames/sequence.json" }],
          withoutSequence: [{ videoName: "PITCH_IN.mov" }],
        }}
        projectName="GameName_FS"
        isDevMode
        onConvert={vi.fn()}
        onImportWithoutConverting={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    // The list item for PITCH_IN should contain the filename + an em-dash + the badge.
    // Use a regex against the textContent so we tolerate whitespace from React's
    // span boundaries — what we care about is that the user SEES the separator.
    const items = screen.getAllByRole("listitem");
    expect(items.length).toBe(2);
    // Each item's text should match "<name> — <badge text>" with the em-dash.
    for (const li of items) {
      expect(li.textContent ?? "").toMatch(/\.mov\s*—\s*(no sequence|sequence ready)/);
    }
  });

  it("falls back to manual folderPath input when convert returns PROJECT_PATH_NOT_FOUND", () => {
    const onConvert = vi.fn();
    render(
      <MovConversionModal
        isOpen classification={NO_SEQ} projectName="GameName_FS" isDevMode
        onConvert={onConvert} onImportWithoutConverting={vi.fn()} onCancel={vi.fn()}
        lastError={{ code: "PROJECT_PATH_NOT_FOUND", manualPathAllowed: true }}
      />,
    );
    const input = screen.getByLabelText(/folder path on disk/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "C:/abs/path" } });
    fireEvent.click(screen.getByRole("button", { name: /convert and import/i }));
    expect(onConvert).toHaveBeenLastCalledWith({ folderPath: "C:/abs/path" });
  });
});
