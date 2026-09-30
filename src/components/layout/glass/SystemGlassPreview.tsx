import { permissionsOf } from "@/lib/permissions";
import type { AppRole } from "@/types";
import "./system-glass.css";

/** Uses the server's effective roles, including the general-member preview. */
export function SystemGlassPreview({ roles }: { roles: AppRole[] }) {
  return permissionsOf(roles).manageSystem
    ? <span hidden data-system-glass-preview data-liquid-glass-ignore />
    : null;
}
