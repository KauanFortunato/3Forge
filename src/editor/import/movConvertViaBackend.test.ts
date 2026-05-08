import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { convertMovsViaBackend, ConvertViaBackendError, installFfmpegViaBackend } from "./movConvertViaBackend";

function mockMovFile(name: string): File {
  return new File([new Uint8Array([0x6d, 0x6f, 0x76])], name, { type: "video/quicktime" });
}

function manifestResponse(jobId: string, source: string, frameCount: number) {
  return new Response(JSON.stringify({
    jobId,
    source,
    sequenceJson: {
      version: 1, type: "image-sequence", source,
      framePattern: "frame_%06d.png", frameCount,
      fps: 0, width: 0, height: 0, durationSec: 0,
      loop: true, alpha: true, pixelFormat: "rgba",
    },
    frameCount,
    fps: 0,
    alpha: true,
    frames: Array.from({ length: frameCount }, (_, i) => ({
      index: i + 1,
      filename: `frame_${String(i + 1).padStart(6, "0")}.png`,
      url: `/api/w3d/convert-mov/jobs/${jobId}/frames/frame_${String(i + 1).padStart(6, "0")}.png`,
      sizeBytes: 1024,
    })),
    ffmpegSource: "static",
  }), { status: 200 });
}

let originalFetch: typeof globalThis.fetch | undefined;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  if (originalFetch) globalThis.fetch = originalFetch;
});

describe("convertMovsViaBackend", () => {
  it("converts a list of MOVs via octet-stream POST and returns sequences map", async () => {
    const fetchMock = vi.fn(async (_url, init?: RequestInit) => {
      const filename = String((init?.headers as Record<string, string>)?.["X-Filename"] ?? "");
      return manifestResponse("job-" + filename, filename, 3);
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const ctrl = new AbortController();
    const result = await convertMovsViaBackend({
      movFiles: [mockMovFile("intro.mov"), mockMovFile("outro.mov")],
      signal: ctrl.signal,
    });
    expect(result.sequences.size).toBe(2);
    const intro = result.sequences.get("intro.mov");
    expect(intro).toBeDefined();
    expect(intro?.frameCount).toBe(3);
    expect(intro?.frameUrls.length).toBe(3);
    expect(intro?.frameUrls[0]).toMatch(/jobs\/job-intro\.mov\/frames\/frame_000001\.png/);
    expect(intro?.type).toBe("image-sequence");
    expect(result.failed).toEqual([]);
    // Both POSTs were sent with octet-stream + X-Filename header
    const calls = fetchMock.mock.calls;
    expect(calls.length).toBe(2);
    for (const [, init] of calls) {
      const headers = (init as RequestInit).headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/octet-stream");
      expect(headers["X-Filename"]).toMatch(/\.mov$/);
    }
  });

  it("emits progress callbacks for each upload", async () => {
    const fetchMock = vi.fn(async (_url, init?: RequestInit) => {
      const filename = String((init?.headers as Record<string, string>)?.["X-Filename"] ?? "");
      return manifestResponse("job-" + filename, filename, 1);
    });
    globalThis.fetch = fetchMock as typeof globalThis.fetch;
    const events: string[] = [];
    await convertMovsViaBackend({
      movFiles: [mockMovFile("a.mov"), mockMovFile("b.mov")],
      signal: new AbortController().signal,
      onProgress: (p) => events.push(`${p.phase}:${"movName" in p ? p.movName : ""}`),
    });
    expect(events).toEqual([
      "uploading:a.mov",
      "converted:a.mov",
      "uploading:b.mov",
      "converted:b.mov",
      "done:",
    ]);
  });

  it("throws ConvertViaBackendError with code FFMPEG_NOT_INSTALLED when backend reports it", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: "FFMPEG_NOT_INSTALLED", installHint: "Install ffmpeg" }), { status: 500 }),
    ) as typeof globalThis.fetch;
    await expect(convertMovsViaBackend({
      movFiles: [mockMovFile("x.mov")],
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: "ConvertViaBackendError",
      code: "FFMPEG_NOT_INSTALLED",
    });
  });

  it("throws ConvertViaBackendError with code NO_BACKEND on 404", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("not found", { status: 404 }),
    ) as typeof globalThis.fetch;
    await expect(convertMovsViaBackend({
      movFiles: [mockMovFile("x.mov")],
      signal: new AbortController().signal,
    })).rejects.toMatchObject({
      name: "ConvertViaBackendError",
      code: "NO_BACKEND",
    });
  });

  it("propagates AbortError when signal is aborted before upload", async () => {
    globalThis.fetch = vi.fn(async () => manifestResponse("j", "x.mov", 1)) as typeof globalThis.fetch;
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(convertMovsViaBackend({
      movFiles: [mockMovFile("x.mov")],
      signal: ctrl.signal,
    })).rejects.toMatchObject({ name: "AbortError" });
  });

  it("collects per-mov soft failures without throwing", async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async (_u, init?: RequestInit) => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({ code: "MOV_DECODE_FAILED", message: "bad codec" }), { status: 500 });
      }
      const filename = String((init?.headers as Record<string, string>)?.["X-Filename"] ?? "");
      return manifestResponse("ok", filename, 2);
    }) as typeof globalThis.fetch;
    const result = await convertMovsViaBackend({
      movFiles: [mockMovFile("bad.mov"), mockMovFile("good.mov")],
      signal: new AbortController().signal,
    });
    expect(result.sequences.size).toBe(1);
    expect(result.sequences.has("good.mov")).toBe(true);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0].mov).toBe("bad.mov");
  });
});

describe("installFfmpegViaBackend", () => {
  it("resolves silently when the backend reports ok", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, source: "static" }), { status: 200 }),
    ) as typeof globalThis.fetch;
    await expect(
      installFfmpegViaBackend(new AbortController().signal),
    ).resolves.toBeUndefined();
  });

  it("throws NO_BACKEND on 404", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response("not found", { status: 404 }),
    ) as typeof globalThis.fetch;
    await expect(
      installFfmpegViaBackend(new AbortController().signal),
    ).rejects.toMatchObject({ name: "ConvertViaBackendError", code: "NO_BACKEND" });
  });

  it("throws ConvertViaBackendError with the backend code on install failure", async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ code: "INSTALL_FAILED", message: "exit 1" }), { status: 500 }),
    ) as typeof globalThis.fetch;
    await expect(
      installFfmpegViaBackend(new AbortController().signal),
    ).rejects.toMatchObject({ name: "ConvertViaBackendError", code: "INSTALL_FAILED" });
  });
});

describe("ConvertViaBackendError", () => {
  it("has the right name and code property", () => {
    const err = new ConvertViaBackendError("FFMPEG_NOT_INSTALLED", "x");
    expect(err.name).toBe("ConvertViaBackendError");
    expect(err.code).toBe("FFMPEG_NOT_INSTALLED");
    expect(err instanceof Error).toBe(true);
  });
});
