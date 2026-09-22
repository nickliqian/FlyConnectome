"""nmf_ctrl — vendored & adapted NeuroMechFly v2 locomotion controllers.

Original source: NeLy-EPFL/flygym v2.1.0, `src/flygym_demo/complex_terrain/`
(Apache-2.0). Adapted here to run against the *installed* flygym 2.0.1 +
MuJoCo 3.6 on macOS x64:

  * `NeuroMechFly` -> `Fly` (2.0.1 has no NeuroMechFly alias)
  * MjsJoint stiffness/damping are scalars on MuJoCo 3.6 (not 3.7 arrays)
  * the 2.1-only `Simulation.get_bodysegment_contact_forces` is unavailable,
    so the hybrid controller's per-link stumbling sensor is approximated from
    2.0.1's per-leg `get_ground_contact_info` (see hybrid_controller.py)
  * package imports rewritten from `flygym_demo.complex_terrain.*` to local
    relative imports
  * preprogrammed-step asset loaded from the local `assets/` folder
"""
from .common import (
    LocomotionAction,
    apply_locomotion_action,
    dof_spec_to_jointdof,
    get_default_locomotion_dof_order,
    make_locomotion_fly,
)
from .preprogrammed import PreprogrammedSteps
from .cpg_controller import (
    CPGController,
    CPGNetwork,
    calculate_ddt,
    get_cpg_biases,
    make_tripod_cpg_network,
)
from .turning_controller import TurningCPGController
from .cx_heading import RingAttractor

__all__ = [
    "LocomotionAction",
    "apply_locomotion_action",
    "dof_spec_to_jointdof",
    "get_default_locomotion_dof_order",
    "make_locomotion_fly",
    "PreprogrammedSteps",
    "CPGController",
    "CPGNetwork",
    "calculate_ddt",
    "get_cpg_biases",
    "make_tripod_cpg_network",
    "TurningCPGController",
]
