import { FabricClient } from "../client/fabric-client.js";

export class WorkspaceGuard {
  private patterns: string[];
  private allowAll: boolean;
  private nameCache = new Map<string, string>();

  constructor() {
    const env = process.env.WRITABLE_WORKSPACES?.trim();
    this.patterns = env
      ? env.split(",").map((p) => p.trim()).filter((p) => p.length > 0)
      : [];
    this.allowAll = this.patterns.includes("*");
  }

  async assertWorkspaceAllowed(fabricClient: FabricClient, workspaceId: string): Promise<void> {
    if (this.allowAll) return;

    if (this.patterns.length === 0) {
      throw new Error(
        "WRITABLE_WORKSPACES is not configured. Destructive actions are blocked by default. " +
        "Set WRITABLE_WORKSPACES to a comma-separated list of workspace name patterns, or \"*\" to allow all."
      );
    }

    let name = this.nameCache.get(workspaceId);
    if (!name) {
      const response = await fabricClient.get<{ displayName: string }>(`/workspaces/${workspaceId}`);
      name = response.data.displayName;
      this.nameCache.set(workspaceId, name);
    }

    for (const pattern of this.patterns) {
      if (this.matchesPattern(name, pattern)) return;
    }

    throw new Error(
      `Workspace "${name}" is not in the writable workspaces list. Allowed patterns: ${this.patterns.join(", ")}`
    );
  }

  private matchesPattern(name: string, pattern: string): boolean {
    const regexStr = "^" + pattern.split("*").map(escapeRegExp).join(".*") + "$";
    return new RegExp(regexStr, "i").test(name);
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
