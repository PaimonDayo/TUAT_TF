"use client";

import { useState, type ComponentType } from "react";

/** Keep lazy fallback/loading behavior for cold opens, but show warmed code
 * synchronously. Importing code on intent never mounts a hidden form. */
export function withIntentPreload<P extends object>(
  fallback: ComponentType<P>,
  load: () => Promise<ComponentType<P>>,
) {
  let ready: ComponentType<P> | undefined;
  let pending: Promise<void> | undefined;
  function IntentForm(props: P) {
    // Pin the choice for this mount. Finishing a preload while someone types
    // must never replace the component and discard its local input state.
    const [Form] = useState(() => ready ?? fallback);
    return <Form {...props} />;
  }
  function preload() {
    if (ready || pending) return;
    pending = load().then((Form) => { ready = Form; }).catch(() => { pending = undefined; });
  }
  return Object.assign(IntentForm, { preload });
}
