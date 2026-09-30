import { permissionsOf } from "@/lib/permissions";
import type { AppRole } from "@/types";
import { SystemGlassMarker } from "./system-glass-state";
import { canUseNewUi } from "@/lib/new-ui";
import "./system-glass.css";
import "./new-ui.css";

/** Uses the server's effective roles, including the general-member preview. */
export function SystemGlassPreview({ roles, userId }: { roles: AppRole[]; userId: string }) {
  return canUseNewUi(roles)
    ? <SystemGlassMarker key={userId} userId={userId} preserveCaptureLayout={permissionsOf(roles).manageSystem} />
    : null;
}
