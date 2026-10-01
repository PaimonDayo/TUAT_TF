export type GlassSpring = { x: number; v: number };

/** Closed-form motion shared by bottom tabs and in-page selection lenses. */
export function spring(state: GlassSpring, target: number, dt: number, omega = 32, zeta = 1) {
  const x = state.x - target, v = state.v, decay = Math.exp(-zeta * omega * dt);
  if (zeta === 1) {
    const c = v + omega * x;
    state.x = target + (x + c * dt) * decay;
    state.v = (v - omega * c * dt) * decay;
    return;
  }
  const wd = omega * Math.sqrt(1 - zeta * zeta), c = (v + zeta * omega * x) / wd;
  const cos = Math.cos(wd * dt), sin = Math.sin(wd * dt);
  state.x = target + decay * (x * cos + c * sin);
  state.v = decay * ((-zeta * omega * x + c * wd) * cos + (-zeta * omega * c - x * wd) * sin);
}
