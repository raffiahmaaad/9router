"use server";

import { NextResponse } from "next/server";
import { isLocalOnlyBlocked, localOnlyResponse } from "@/lib/localOnly";

async function loadLocalMitmAliasDeps() {
  const [models, manager] = await Promise.all([
    import("@/models"),
    import("@/mitm/manager"),
  ]);
  return { ...models, ...manager };
}

export async function GET(request) {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { getMitmAlias } = await loadLocalMitmAliasDeps();
    const { searchParams } = new URL(request.url);
    const toolName = searchParams.get("tool");
    const aliases = await getMitmAlias(toolName || undefined);
    return NextResponse.json({ aliases });
  } catch (error) {
    console.log("Error fetching MITM aliases:", error.message);
    return NextResponse.json({ error: "Failed to fetch aliases" }, { status: 500 });
  }
}

export async function PUT(request) {
  if (isLocalOnlyBlocked()) return localOnlyResponse();

  try {
    const { getMitmStatus, setMitmAliasAll } = await loadLocalMitmAliasDeps();
    const { tool, mappings } = await request.json();

    if (!tool || !mappings || typeof mappings !== "object") {
      return NextResponse.json({ error: "tool and mappings required" }, { status: 400 });
    }

    const status = await getMitmStatus();
    if (!status.dnsStatus || !status.dnsStatus[tool]) {
      return NextResponse.json(
        { error: `DNS must be enabled for ${tool} before editing model mappings` },
        { status: 403 }
      );
    }

    const filtered = {};
    for (const [alias, model] of Object.entries(mappings)) {
      if (model && model.trim()) filtered[alias] = model.trim();
    }

    await setMitmAliasAll(tool, filtered);
    return NextResponse.json({ success: true, aliases: filtered });
  } catch (error) {
    console.log("Error saving MITM aliases:", error.message);
    return NextResponse.json({ error: "Failed to save aliases" }, { status: 500 });
  }
}
