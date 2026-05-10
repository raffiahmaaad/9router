import { NextResponse } from "next/server";
import { isLocalOnlyBlocked, localOnlyResponse } from "@/lib/localOnly";

const DEFAULT_MITM_ROUTER_BASE = "http://127.0.0.1:20128";
const isWin = process.platform === "win32";

function normalizeMitmRouterBaseUrlInput(input) {
  if (input == null || String(input).trim() === "") return DEFAULT_MITM_ROUTER_BASE;
  const t = String(input).trim().replace(/\/+$/, "");
  let u;
  try {
    u = new URL(t);
  } catch {
    throw new Error("Invalid MITM router URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("MITM router URL must use http or https");
  }
  return t;
}

async function loadMitmDeps() {
  const [manager, localDb] = await Promise.all([
    import("@/mitm/manager"),
    import("@/lib/localDb"),
  ]);
  manager.initDbHooks(localDb.getSettings, localDb.updateSettings);
  return { manager, localDb };
}

function getPassword(manager, provided) {
  return provided || manager.getCachedPassword() || null;
}

function requiresSudoPassword(manager, pwd) {
  return !isWin && !pwd && manager.isSudoPasswordRequired();
}

async function checkIsAdmin() {
  if (isWin) {
    try {
      const { execFileSync } = await import("child_process");
      execFileSync("net", ["session"], { stdio: "ignore", windowsHide: true });
      return true;
    } catch {
      return false;
    }
  }
  return typeof process.getuid === "function" && process.getuid() === 0;
}

async function checkPrivilege(manager, pwd) {
  if (await checkIsAdmin()) return true;
  if (isWin) return false;
  if (!manager.isSudoPasswordRequired()) return true;
  return !!pwd;
}

export async function GET() {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { manager, localDb } = await loadMitmDeps();
    const status = await manager.getMitmStatus();
    const settings = await localDb.getSettings();
    const hasCachedPassword = !!manager.getCachedPassword() || !!(await manager.loadEncryptedPassword());
    return NextResponse.json({
      running: status.running,
      pid: status.pid || null,
      certExists: status.certExists || false,
      certTrusted: status.certTrusted || false,
      dnsStatus: status.dnsStatus || {},
      hasCachedPassword,
      isWin,
      needsSudoPassword: !isWin && !hasCachedPassword && manager.isSudoPasswordRequired(),
      isAdmin: await checkIsAdmin(),
      mitmRouterBaseUrl:
        (settings.mitmRouterBaseUrl && String(settings.mitmRouterBaseUrl).trim()) ||
        DEFAULT_MITM_ROUTER_BASE,
    });
  } catch (error) {
    console.log("Error getting MITM status:", error.message);
    return NextResponse.json({ error: "Failed to get MITM status" }, { status: 500 });
  }
}

export async function POST(request) {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { manager, localDb } = await loadMitmDeps();
    const { apiKey, sudoPassword, mitmRouterBaseUrl, forceKillPort443 } = await request.json();
    const pwd = getPassword(manager, sudoPassword) || await manager.loadEncryptedPassword() || "";

    if (!apiKey || requiresSudoPassword(manager, pwd)) {
      return NextResponse.json(
        { error: !apiKey ? "Missing apiKey" : "Missing sudoPassword" },
        { status: 400 }
      );
    }

    if (!(await checkPrivilege(manager, pwd))) {
      return NextResponse.json(
        { error: isWin ? "Administrator required — restart 9Router as Administrator" : "Root or sudo password required to start MITM" },
        { status: 403 }
      );
    }

    if (mitmRouterBaseUrl !== undefined && mitmRouterBaseUrl !== null) {
      try {
        const normalized = normalizeMitmRouterBaseUrlInput(mitmRouterBaseUrl);
        await localDb.updateSettings({ mitmRouterBaseUrl: normalized });
      } catch (e) {
        return NextResponse.json({ error: e.message || "Invalid MITM router URL" }, { status: 400 });
      }
    }

    const result = await manager.startServer(apiKey, pwd, !!forceKillPort443);
    if (!isWin) manager.setCachedPassword(pwd);

    return NextResponse.json({ success: true, running: result.running, pid: result.pid });
  } catch (error) {
    console.log("Error starting MITM server:", error.message);
    if (error.code === "PORT_443_BUSY") {
      return NextResponse.json(
        { error: error.message, code: "PORT_443_BUSY", portOwner: error.portOwner },
        { status: 409 }
      );
    }
    return NextResponse.json({ error: error.message || "Failed to start MITM server" }, { status: 500 });
  }
}

export async function DELETE(request) {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { manager } = await loadMitmDeps();
    const body = await request.json().catch(() => ({}));
    const { sudoPassword } = body;
    const pwd = getPassword(manager, sudoPassword) || await manager.loadEncryptedPassword() || "";

    if (requiresSudoPassword(manager, pwd)) {
      return NextResponse.json({ error: "Missing sudoPassword" }, { status: 400 });
    }

    await manager.stopServer(pwd);
    if (!isWin && sudoPassword) manager.setCachedPassword(sudoPassword);

    return NextResponse.json({ success: true, running: false });
  } catch (error) {
    console.log("Error stopping MITM server:", error.message);
    return NextResponse.json({ error: error.message || "Failed to stop MITM server" }, { status: 500 });
  }
}

export async function PATCH(request) {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { manager } = await loadMitmDeps();
    const { tool, action, sudoPassword } = await request.json();
    const pwd = getPassword(manager, sudoPassword) || await manager.loadEncryptedPassword() || "";

    if (!tool || !action) {
      return NextResponse.json({ error: "tool and action required" }, { status: 400 });
    }
    if (requiresSudoPassword(manager, pwd)) {
      return NextResponse.json({ error: "Missing sudoPassword" }, { status: 400 });
    }
    if (!(await checkPrivilege(manager, pwd))) {
      return NextResponse.json(
        { error: isWin ? "Administrator required — restart 9Router as Administrator" : "Root or sudo password required to modify DNS" },
        { status: 403 }
      );
    }

    if (action === "enable") {
      await manager.enableToolDNS(tool, pwd);
    } else if (action === "disable") {
      await manager.disableToolDNS(tool, pwd);
    } else if (action === "trust-cert") {
      await manager.trustCert(pwd);
      if (!isWin && sudoPassword) manager.setCachedPassword(sudoPassword);
      const status = await manager.getMitmStatus();
      return NextResponse.json({ success: true, certTrusted: status.certTrusted });
    } else {
      return NextResponse.json({ error: "action must be enable, disable, or trust-cert" }, { status: 400 });
    }

    if (!isWin && sudoPassword) manager.setCachedPassword(sudoPassword);

    const status = await manager.getMitmStatus();
    return NextResponse.json({ success: true, dnsStatus: status.dnsStatus });
  } catch (error) {
    console.log("Error toggling DNS:", error.message);
    return NextResponse.json({ error: error.message || "Failed to toggle DNS" }, { status: 500 });
  }
}
