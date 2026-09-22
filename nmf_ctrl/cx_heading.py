"""Central-complex heading integrator (ellipsoid-body ring attractor).

The same architecture used in the L2 demo, packaged for the L3 embodied loop:
N units arranged on a ring hold a self-sustaining activity bump whose position
psi is the internal heading estimate. Two channels move/anchor the bump:

  * idiothetic : angular velocity *translates the activity profile exactly*
      (interpolated ring shift, dpsi = rot_vel * dt). Pushing the bump with
      asymmetric recurrent input instead (the textbook P-EN scheme) turns out
      to be unreliable on a coarse ring: the response gain is non-linear and
      periodic stride wobble ratchets the bump around. Exact translation makes
      path integration linear; the attractor below keeps the bump coherent.
  * allothetic : a compass cue (von Mises bump) pulls the bump toward the cue
      angle, e.g. cue = wrap(beacon_world - beacon_relative). The recurrent
      kernel resists sudden jumps, so the cue corrects drift smoothly instead
      of teleporting the bump.

Activity is divisively normalised each step (total activity held at N), which
bounds r so a weak compass cue can always re-anchor the bump after a period of
pure path integration.
"""
from __future__ import annotations

import numpy as np

_WRAP = lambda a: (a + np.pi) % (2 * np.pi) - np.pi


class RingAttractor:
    """Minimal EB ring attractor heading integrator."""

    def __init__(
        self,
        n: int = 16,
        kappa: float = 2.5,
        j_exc: float = 1.6,
        tau: float = 0.03,
        w_cue: float = 0.9,
        kappa_cue: float = 4.0,
    ) -> None:
        self.th = np.linspace(0, 2 * np.pi, n, endpoint=False)
        d = self.th[:, None] - self.th[None, :]
        m = np.exp(np.cos(d) * kappa)
        self.w0 = j_exc * m / m.sum(axis=1, keepdims=True)
        self.tau, self.w_cue, self.kappa_cue = tau, w_cue, kappa_cue
        self.n = n
        self.r = np.exp(np.cos(self.th) * kappa)
        self.r = self.r / self.r.sum() * n

    def psi(self) -> float:
        return float(
            np.arctan2((self.r * np.sin(self.th)).sum(),
                       (self.r * np.cos(self.th)).sum())
        )

    def _shift(self, dpsi: float) -> None:
        """Translate the activity profile by dpsi (r_new(th) = r(th - dpsi))."""
        sh = dpsi * self.n / (2 * np.pi)
        k = int(np.floor(sh))
        f = sh - k
        self.r = (1 - f) * np.roll(self.r, k) + f * np.roll(self.r, k + 1)

    def step(self, dt: float, rot_vel: float, cue: float,
             w_cue: float | None = None) -> float:
        self._shift(rot_vel * dt)                      # idiothetic path integration
        wc = self.w_cue if w_cue is None else w_cue
        i_cue = wc * np.exp(np.cos(self.th - cue) * self.kappa_cue)
        drv = -self.r + np.maximum(self.w0 @ self.r + i_cue, 0.0)
        self.r = np.maximum(self.r + dt / self.tau * drv, 0.0)
        s = self.r.sum()
        if s > 1e-9:
            self.r = self.r / s * self.n
        return self.psi()
