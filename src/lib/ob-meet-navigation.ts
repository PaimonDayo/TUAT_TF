export type ObWorkspaceView = "participant" | "operations";
export type ObOperationSection = "events" | "program" | "duties" | "participants" | "mine";

/** Existing home, duty-review and identity links keep reaching their original task. */
export function obWorkspaceDestination(params: { view?: string; section?: string; edit?: string }, canOperate: boolean, staff: boolean) {
  const view: ObWorkspaceView = canOperate ? "operations" : "participant";
  const requestedSection = params.edit === "identity" || params.view === "management" ? "participants"
    : params.edit === "mine" || ["participant", "program", "mine"].includes(params.view ?? "") ? "mine"
    : params.view === "duties" ? "duties" : params.section;
  const section: ObOperationSection = requestedSection === "program" ? "program"
    : requestedSection === "duties" ? "duties"
    : requestedSection === "mine" ? "mine"
    : !canOperate ? "program"
    : requestedSection === "participants" && staff ? "participants" : "events";
  return { view, section };
}
