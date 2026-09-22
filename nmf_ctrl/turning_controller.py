"""Clean CPG turning controller for flygym 2.0.1.

Faithful to the NeuroMechFly v2 turning mechanism: a two-value *descending
signal* [left, right] modulates each side's CPG amplitude (stride strength) and
frequency sign (forward/backward stepping). The difference between the two sides
makes the fly turn. We keep the reference CPGController's phase->preprogrammed-
step mapping and adhesion gating, but drop the hybrid controller's per-link
stumbling/retraction corrections (they need flygym 2.1's
`get_bodysegment_contact_forces`, which 2.0.1 lacks, and are inert on flat
ground anyway).

This descending signal is exactly where an L2-style central-complex (CX) heading
command plugs in: a ring-attractor heading estimate compared against a target
heading yields a turn command that drives [left, right].
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from flygym.anatomy import JointDOF, LEGS
from .common import LocomotionAction, get_default_locomotion_dof_order
from .cpg_controller import CPGNetwork, make_tripod_cpg_network
from .preprogrammed import PreprogrammedSteps


@dataclass
class TurningCPGController:
    """Tripod CPG walking controller with side-specific descending modulation."""

    timestep: float
    cpg_network: CPGNetwork | None = None
    preprogrammed_steps: PreprogrammedSteps = field(
        default_factory=PreprogrammedSteps
    )
    output_dof_order: list[JointDOF] | None = None
    enable_adhesion: bool = True
    legs: tuple[str, ...] = tuple(LEGS)

    def __post_init__(self) -> None:
        if self.cpg_network is None:
            self.cpg_network = make_tripod_cpg_network(self.timestep)
        self._base_intrinsic_freqs = self.cpg_network.intrinsic_freqs.copy()
        self._base_intrinsic_amps = self.cpg_network.intrinsic_amps.copy()

    def reset(self, *, seed: int | None = None) -> None:
        if seed is not None:
            self.cpg_network.random_state = np.random.RandomState(seed)
        self.cpg_network.intrinsic_freqs = self._base_intrinsic_freqs.copy()
        self.cpg_network.intrinsic_amps = self._base_intrinsic_amps.copy()
        self.cpg_network.reset()

    def set_descending_signal(self, descending_signal: np.ndarray) -> None:
        """Apply the [left, right] descending command to the CPG.

        Amplitude per side = |signal| (stride strength). Frequency sign per side
        follows the signal sign (negative -> that tripod steps backward, aiding a
        sharp turn). Legs are ordered [lf, lm, lh, rf, rm, rh], so indices 0:3 are
        the left tripod and 3:6 the right.
        """
        descending_signal = np.asarray(descending_signal, dtype=float)
        if descending_signal.shape != (2,):
            raise ValueError("descending_signal must have shape (2,).")
        self.cpg_network.intrinsic_amps = np.repeat(
            np.abs(descending_signal[:, np.newaxis]), 3, axis=1
        ).ravel()
        intrinsic_freqs = self._base_intrinsic_freqs.copy()
        intrinsic_freqs[:3] *= 1 if descending_signal[0] >= 0 else -1
        intrinsic_freqs[3:] *= 1 if descending_signal[1] >= 0 else -1
        self.cpg_network.intrinsic_freqs = intrinsic_freqs

    def step(self, descending_signal: np.ndarray | None = None) -> LocomotionAction:
        if descending_signal is not None:
            self.set_descending_signal(descending_signal)
        self.cpg_network.step()
        joint_angles = self.preprogrammed_steps.get_joint_angles_by_dof_order(
            self.cpg_network.curr_phases,
            self.cpg_network.curr_magnitudes,
            self.output_dof_order,
        )
        if self.enable_adhesion:
            adhesion_onoff = self.preprogrammed_steps.get_adhesion_onoff_by_phase(
                self.cpg_network.curr_phases
            )
        else:
            adhesion_onoff = np.zeros(len(self.legs), dtype=bool)
        return LocomotionAction(
            joint_angles=joint_angles, adhesion_onoff=adhesion_onoff
        )
