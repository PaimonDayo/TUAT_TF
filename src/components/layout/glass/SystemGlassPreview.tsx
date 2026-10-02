import { permissionsOf } from "@/lib/permissions";
import type { AppRole } from "@/types";
import { SystemGlassMarker } from "./system-glass-state";
import "./system-glass.css";
import "./new-ui.css";

/** All authenticated members can opt in; roles only preserve the existing capture layout. */
export function SystemGlassPreview({ roles, userId }: { roles: AppRole[]; userId: string }) {
  return <SystemGlassMarker key={userId} userId={userId} preserveCaptureLayout={permissionsOf(roles).manageSystem} />;
}
