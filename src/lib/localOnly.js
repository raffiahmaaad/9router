import { NextResponse } from "next/server";
import { isHostedMode } from "@/lib/runtimeMode";

export function isLocalOnlyBlocked() {
  return isHostedMode();
}

export function localOnlyResponse() {
  return NextResponse.json(
    {
      error: "This feature is only available in local mode",
      code: "LOCAL_ONLY_FEATURE",
    },
    { status: 409 }
  );
}
