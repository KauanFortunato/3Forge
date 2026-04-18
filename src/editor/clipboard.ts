export type ClipboardWriteResult =
  | { status: "copied"; permission: PermissionState | "unsupported" }
  | { status: "denied"; permission: PermissionState | "unsupported" }
  | { status: "unsupported" }
  | { status: "failed"; error: unknown };

interface BrowserClipboardLike {
  writeText(value: string): Promise<void>;
}

interface BrowserPermissionsLike {
  query(descriptor: { name: string }): Promise<{ state: PermissionState }>;
}

interface BrowserNavigatorLike {
  clipboard?: BrowserClipboardLike;
  permissions?: BrowserPermissionsLike;
}

export async function queryClipboardWritePermission(navigatorObject: BrowserNavigatorLike = navigator): Promise<PermissionState | "unsupported"> {
  if (!navigatorObject.permissions || typeof navigatorObject.permissions.query !== "function") {
    return "unsupported";
  }

  try {
    const result = await navigatorObject.permissions.query({ name: "clipboard-write" });
    return result.state;
  } catch {
    return "unsupported";
  }
}

export async function writeTextToClipboard(
  value: string,
  navigatorObject: BrowserNavigatorLike = navigator,
): Promise<ClipboardWriteResult> {
  if (!navigatorObject.clipboard || typeof navigatorObject.clipboard.writeText !== "function") {
    return { status: "unsupported" };
  }

  const permission = await queryClipboardWritePermission(navigatorObject);
  if (permission === "denied") {
    return { status: "denied", permission };
  }

  try {
    await navigatorObject.clipboard.writeText(value);
    return { status: "copied", permission };
  } catch (error) {
    return { status: "failed", error };
  }
}
