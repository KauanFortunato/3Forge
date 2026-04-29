import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AIGenerateDialog } from "./AIGenerateDialog";
import type { AiChatGenerationResult } from "./AIGenerateDialog";

const sceneSpecJson = JSON.stringify({
  componentName: "Edited Starter",
  objects: [
    {
      type: "box",
      name: "Main Body",
      color: "#7c3aed",
      opacity: 1,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      width: 1,
      height: 1,
      depth: 1,
      radius: null,
      radiusTop: null,
      radiusBottom: null,
      text: null,
      size: null,
    },
  ],
}, null, 2);

function renderDialog(overrides: Partial<React.ComponentProps<typeof AIGenerateDialog>> = {}) {
  const onGenerate = vi.fn(async (): Promise<AiChatGenerationResult> => ({
    content: "I prepared a project update.",
    sceneSpecJson,
    rawText: sceneSpecJson,
  }));
  const onApplyScene = vi.fn();
  const onClose = vi.fn();

  render(
    <AIGenerateDialog
      isOpen
      projectId="project-a"
      onClose={onClose}
      onGenerate={onGenerate}
      onApplyScene={onApplyScene}
      {...overrides}
    />,
  );

  return { onGenerate, onApplyScene, onClose };
}

describe("AIGenerateDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("sends chat prompts, stores history, and applies returned JSON", async () => {
    const user = userEvent.setup();
    const { onGenerate, onApplyScene } = renderDialog();

    await user.click(screen.getByText("AI settings"));
    await user.type(screen.getByLabelText("OpenRouter API key"), "sk-or-test");
    await user.clear(screen.getByPlaceholderText("Write a request..."));
    await user.type(screen.getByPlaceholderText("Write a request..."), "make it sharper");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
      "sk-or-test",
      "make it sharper",
      "openrouter",
      "openrouter/free",
      "edit",
    ));

    expect(await screen.findByText("I prepared a project update.")).not.toBeNull();
    expect(window.localStorage.getItem("3forge-ai-chat-history-v1:project-a")).toContain("make it sharper");

    await user.click(screen.getByText("View JSON"));
    expect(screen.getByText(/Edited Starter/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Apply" }));

    expect(onApplyScene).toHaveBeenCalledWith(sceneSpecJson, "edit");
    expect((await screen.findByRole("button", { name: "Applied" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("restores provider identity and ignores corrupt chat storage", () => {
    window.localStorage.setItem("3forge-ai-provider", "gemini");
    window.localStorage.setItem("3forge-ai-model-gemini", "gemini-2.5-flash");
    window.localStorage.setItem("3forge-ai-chat-history-v1:project-a", "{bad");

    renderDialog();

    expect(screen.getAllByText("Gemini Free").length).toBeGreaterThan(0);
    expect(screen.getByText("gemini-2.5-flash")).not.toBeNull();
    expect(screen.getByText(/Tell me what to change in this project/)).not.toBeNull();
  });

  it("keeps a pending generation when the dialog is hidden and shows the response when reopened", async () => {
    const user = userEvent.setup();
    let resolveGeneration: (result: AiChatGenerationResult) => void = () => {};
    const onGenerate = vi.fn(() => new Promise<AiChatGenerationResult>((resolve) => {
      resolveGeneration = resolve;
    }));
    const onApplyScene = vi.fn();
    const onClose = vi.fn();
    const props = {
      projectId: "project-a",
      onClose,
      onGenerate,
      onApplyScene,
    };
    const { rerender } = render(<AIGenerateDialog isOpen {...props} />);

    await user.click(screen.getByText("AI settings"));
    await user.type(screen.getByLabelText("OpenRouter API key"), "sk-or-test");
    await user.clear(screen.getByPlaceholderText("Write a request..."));
    await user.type(screen.getByPlaceholderText("Write a request..."), "continue in background");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(1));
    rerender(<AIGenerateDialog isOpen={false} {...props} />);
    expect(screen.queryByLabelText("AI chat history")).toBeNull();

    resolveGeneration({
      content: "Background response ready.",
      sceneSpecJson,
      rawText: sceneSpecJson,
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("3forge-ai-chat-history-v1:project-a")).toContain("Background response ready.");
    });

    rerender(<AIGenerateDialog isOpen {...props} />);
    expect(await screen.findByText("Background response ready.")).not.toBeNull();
  });
});
