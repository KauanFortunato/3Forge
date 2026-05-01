import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AiBlueprintDebugError } from "../../aiBlueprint";
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
    executedModel: "google/gemini-2.5-flash-lite",
    changes: {
      added: 1,
      changed: 2,
      removed: 0,
      items: [
        { kind: "added", label: "Violet accent light" },
        { kind: "changed", label: "Main Body", detail: "color and scale" },
      ],
    },
  }));
  const onApplyScene = vi.fn();

  const result = render(
    <AIGenerateDialog
      isOpen
      projectId="project-a"
      onGenerate={onGenerate}
      onApplyScene={onApplyScene}
      {...overrides}
    />,
  );

  return { onGenerate, onApplyScene, ...result };
}

describe("AIGenerateDialog", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("sends chat prompts, stores history, and applies returned JSON", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { onGenerate, onApplyScene } = renderDialog();

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Config" }));
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
      undefined,
      undefined,
    ));

    expect(await screen.findByText("I prepared a project update.")).not.toBeNull();
    expect(screen.getByText("google/gemini-2.5-flash-lite")).not.toBeNull();
    expect(screen.getByLabelText("Changes")).not.toBeNull();
    expect(screen.getByText("Violet accent light")).not.toBeNull();
    expect(screen.getByText("Main Body")).not.toBeNull();
    const storedHistory = window.localStorage.getItem("3forge-ai-chat-history-v1:project-a");
    expect(storedHistory).toContain("make it sharper");
    expect(storedHistory).toContain("\"changes\"");
    expect(storedHistory).toContain("Violet accent light");

    await user.click(screen.getByText("View JSON"));
    expect(screen.getByText(/Edited Starter/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Copy JSON" }));
    expect(writeText).toHaveBeenCalledWith(sceneSpecJson);
    expect(screen.getByRole("button", { name: "Copied" })).not.toBeNull();
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

  it("allows a local OpenAI-compatible provider with a custom URL and optional key", async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Config" }));
    await user.selectOptions(screen.getByLabelText("Provider"), "local");
    await user.clear(screen.getByLabelText("Model"));
    await user.type(screen.getByLabelText("Model"), "qwen-local");
    await user.clear(screen.getByLabelText("Local API URL"));
    await user.type(screen.getByLabelText("Local API URL"), "http://127.0.0.1:8001/v1/chat/completions");
    await user.clear(screen.getByPlaceholderText("Write a request..."));
    await user.type(screen.getByPlaceholderText("Write a request..."), "make a lamp");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledWith(
      "",
      "make a lamp",
      "local",
      "qwen-local",
      "edit",
      "http://127.0.0.1:8001/v1/chat/completions",
      undefined,
    ));
    expect(window.localStorage.getItem("3forge-ai-local-url")).toBe("http://127.0.0.1:8001/v1/chat/completions");
  });

  it("restores persisted change summaries with chat history", () => {
    window.localStorage.setItem("3forge-ai-chat-history-v1:project-a", JSON.stringify([
      {
        id: "assistant-1",
        role: "assistant",
        createdAt: 1,
        provider: "openrouter",
        model: "openrouter/free",
        executedModel: "openrouter/free",
        mode: "edit",
        content: "Stored response ready.",
        sceneSpecJson,
        rawText: sceneSpecJson,
        status: "ready",
        changes: {
          counts: { added: 2, changed: 1, removed: 1 },
          preview: ["Added antenna array", "Changed shell material", "Removed placeholder cube"],
        },
      },
    ]));

    renderDialog();

    expect(screen.getByText("Stored response ready.")).not.toBeNull();
    expect(screen.getByLabelText("Changes")).not.toBeNull();
    expect(screen.getByText("Added antenna array")).not.toBeNull();
    expect(screen.getByText("Changed shell material")).not.toBeNull();
    expect(screen.getByText("Removed placeholder cube")).not.toBeNull();
  });

  it("sends the last JSON and recent diff summaries as compact chat context", async () => {
    const user = userEvent.setup();
    const { onGenerate } = renderDialog();

    await user.click(screen.getByRole("button", { name: "Config" }));
    await user.type(screen.getByLabelText("OpenRouter API key"), "sk-or-test");
    await user.clear(screen.getByPlaceholderText("Write a request..."));
    await user.type(screen.getByPlaceholderText("Write a request..."), "first edit");
    await user.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("I prepared a project update.")).not.toBeNull();

    await user.clear(screen.getByPlaceholderText("Write a request..."));
    await user.type(screen.getByPlaceholderText("Write a request..."), "make that warmer");
    await user.click(screen.getByRole("button", { name: "Send" }));

    await waitFor(() => expect(onGenerate).toHaveBeenCalledTimes(2));
    expect(onGenerate).toHaveBeenLastCalledWith(
      "sk-or-test",
      "make that warmer",
      "openrouter",
      "openrouter/free",
      "edit",
      undefined,
      {
        lastSceneSpecJson: sceneSpecJson,
        diffSummaries: [
          "added 1, changed 2, removed 0; added: Violet accent light; changed: Main Body (color and scale)",
        ],
      },
    );
  });

  it("reveals assistant responses progressively before enabling apply", async () => {
    const user = userEvent.setup();
    const streamedContent = [
      "I am checking the current scene structure, material palette, and object hierarchy before preparing a valid update.",
      "The generated scene will stay unavailable until the full JSON result is ready.",
      "I will keep writing this response progressively so the user can see active work in the chat surface.",
      "Only after the final validated scene result is ready should the JSON preview and Apply action become available.",
      "This keeps the editor interaction clear while preserving the existing generation and apply workflow.",
    ].join(" ");
    let resolveGeneration: (result: AiChatGenerationResult) => void = () => {};
    const onGenerate = vi.fn(() => new Promise<AiChatGenerationResult>((resolve) => {
      resolveGeneration = resolve;
    }));
    const { container } = renderDialog({ onGenerate });

    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Config" }));
    await user.type(screen.getByLabelText("OpenRouter API key"), "sk-or-test");
    await user.clear(screen.getByPlaceholderText("Write a request..."));
    await user.type(screen.getByPlaceholderText("Write a request..."), "make the UI feel like a chat");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByLabelText("AI is typing")).not.toBeNull();

    resolveGeneration({
      content: streamedContent,
      sceneSpecJson,
      rawText: sceneSpecJson,
      executedModel: "google/gemini-2.5-flash-lite",
    });

    await waitFor(() => {
      expect(container.querySelector(".ai-chat-message.is-streaming[data-status='streaming']")).not.toBeNull();
      expect(screen.getByText("writing")).not.toBeNull();
      expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
    });

    expect(await screen.findByText(streamedContent, undefined, { timeout: 3000 })).not.toBeNull();
    expect(await screen.findByRole("button", { name: "Apply" }, { timeout: 3000 })).not.toBeNull();
  });

  it("keeps a pending generation when the dialog is hidden and shows the response when reopened", async () => {
    const user = userEvent.setup();
    let resolveGeneration: (result: AiChatGenerationResult) => void = () => {};
    const onGenerate = vi.fn(() => new Promise<AiChatGenerationResult>((resolve) => {
      resolveGeneration = resolve;
    }));
    const onApplyScene = vi.fn();
    const props = {
      projectId: "project-a",
      onGenerate,
      onApplyScene,
    };
    const { rerender } = render(<AIGenerateDialog isOpen {...props} />);

    await user.click(screen.getByRole("button", { name: "Config" }));
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
      executedModel: "meta-llama/llama-3.3-70b-instruct",
    });

    await waitFor(() => {
      expect(window.localStorage.getItem("3forge-ai-chat-history-v1:project-a")).toContain("Background response ready.");
    });

    rerender(<AIGenerateDialog isOpen {...props} />);
    expect(await screen.findByText("Background response ready.")).not.toBeNull();
    expect(screen.getByText("meta-llama/llama-3.3-70b-instruct")).not.toBeNull();
  });

  it("persists pending assistant activity when the chat is reopened or restored", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn(() => new Promise<AiChatGenerationResult>(() => {}));
    const onApplyScene = vi.fn();
    const props = {
      projectId: "project-a",
      onGenerate,
      onApplyScene,
    };
    const { unmount, rerender } = render(<AIGenerateDialog isOpen {...props} />);

    await user.click(screen.getByRole("button", { name: "Config" }));
    await user.type(screen.getByLabelText("OpenRouter API key"), "sk-or-test");
    await user.clear(screen.getByPlaceholderText("Write a request..."));
    await user.type(screen.getByPlaceholderText("Write a request..."), "keep working while hidden");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByLabelText("AI is typing")).not.toBeNull();
    await waitFor(() => {
      expect(window.localStorage.getItem("3forge-ai-chat-history-v1:project-a")).toContain("\"status\":\"streaming\"");
    });

    rerender(<AIGenerateDialog isOpen={false} {...props} />);
    expect(screen.queryByLabelText("AI chat history")).toBeNull();

    rerender(<AIGenerateDialog isOpen {...props} />);
    expect(await screen.findByLabelText("AI is typing")).not.toBeNull();
    expect(screen.getByText("writing")).not.toBeNull();

    unmount();
    render(<AIGenerateDialog isOpen {...props} />);
    expect(await screen.findByLabelText("AI is typing")).not.toBeNull();
    expect(screen.getByText("keep working while hidden")).not.toBeNull();
  });

  it("shows raw model output when generation fails validation", async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn(async () => {
      throw new AiBlueprintDebugError(
        "The model returned invalid JSON. Expected property name.",
        "{ invalid json",
        "openai/gpt-oss-120b:free",
      );
    });
    renderDialog({ onGenerate });

    await user.click(screen.getByRole("button", { name: "Config" }));
    await user.type(screen.getByLabelText("OpenRouter API key"), "sk-or-test");
    await user.clear(screen.getByPlaceholderText("Write a request..."));
    await user.type(screen.getByPlaceholderText("Write a request..."), "make a lamp");
    await user.click(screen.getByRole("button", { name: "Send" }));

    expect(await screen.findByText("The model returned invalid JSON. Expected property name.")).not.toBeNull();
    expect(screen.getByText("openai/gpt-oss-120b:free")).not.toBeNull();

    await user.click(screen.getByText("View raw response"));
    expect(screen.getByText("{ invalid json")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Apply" })).toBeNull();
  });
});
