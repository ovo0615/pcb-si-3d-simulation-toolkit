# Channel Cutout Equivalence Validation Report

## Summary

This validation answers a concrete question: **after extracting a signal channel
from a full board, how far does the result drift from solving the full board
directly — and how much expansion margin is actually needed?**

Using a purpose-built 40 × 20 mm symmetric stripline coupon:

- **The expansion distance itself barely matters.** 5 mm, 3 mm and 2 mm expansions
  give insertion-loss deviations of 0.0166, 0.0174 and 0.0274 dB respectively.
  Shrinking the retained reference plane from 10.2 mm to 4.2 mm costs 0.01 dB.
- **What actually breaks things is a cutout that removes the ground stitching
  vias.** At 1 mm expansion the 42 stitching vias at Y ±1.5 mm all fall outside
  the retained region and are deleted; deviation jumps to **1.6436 dB**.
- **A control experiment proves the cause is the vias, not the narrow plane.**
  Moving the stitching vias to Y ±0.8 mm — so that the **same 1 mm expansion and
  the same 2.2 mm retained plane width** keep them — brings the deviation back to
  **0.0392 dB**, a **42×** difference.

**The safe condition for cutout is not "use a large enough expansion" but "do not
cut away the ground stitching vias alongside the channel."** This is the same root
cause found in the segmentation validation: reference-plane stitching dominates.

The conclusions apply to the model, bandwidth and solver settings in this report.
They are reproducible engineering evidence, not an unconditional guarantee for
every PCB stackup and structure.

![Cutout validation overview](results/cutout_validation_overview.svg)

---

## Method

### 1. Coupon and variants

![Cutout validation coupon and variants](results/cutout_variants.svg)

The coupon uses the same stackup and materials as the
[segmentation validation](../segmentation/segmentation_validation_report.md); the
only change is a reference plane widened to 20 mm, so that cutting actually removes
material.

| Item | Specification |
|---|---|
| Structure | Symmetric stripline (solid reference plane above and below) |
| Stackup | GND_TOP 35 µm / dielectric 250 µm / SIG 35 µm / dielectric 250 µm / GND_BOT 35 µm |
| Dielectric | εr = 4.0, tanδ = 0.005 |
| Trace | 0.2 mm wide, 38 mm long, 50 Ω target impedance |
| Board / reference planes | 40 × 20 mm |
| Terminations | SIG-layer pads with component-end ports |
| Stitching vias | 2 mm pitch; main experiment at Y ±1.5 mm, control at Y ±0.8 mm |
| Cutout extent | Bounding (rectangular) |

| Variant | Expansion | Retained plane width | Stitching vias |
|---|---|---|---|
| Baseline | — | 40 × 20 mm (no cutout) | All |
| Expansion 5 mm | 5.0 mm | 10.2 mm | 42 retained |
| Expansion 3 mm | 3.0 mm | 6.2 mm | 42 retained |
| Expansion 2 mm | 2.0 mm | 4.2 mm | 42 retained |
| Expansion 1 mm | 1.0 mm | 2.2 mm | **all removed (0)** |
| **Control**: expansion 1 mm | 1.0 mm | 2.2 mm | **42 retained** (vias moved to ±0.8 mm) |

Cutouts are produced by the toolkit's own cutout function; ports are identical
before and after. The control variant has its own full-board baseline, so every
comparison is "the same coupon cut" against "the same coupon uncut".

### 2. Why a control experiment was needed

A 1 mm expansion does two things at once: it leaves only a 2.2 mm wide reference
plane, **and** it deletes every stitching via. The main experiment alone cannot
tell which caused the 1.64 dB deviation.

The control moves the stitching vias to Y ±0.8 mm so that **the same 1 mm expansion
retains them**. Retained plane width is identical; the only difference is whether
the vias survive. That separates the two variables.

### 3. Solver settings

Identical for every variant:

- Solver: Ansys HFSS 3D Layout 2026 R1
- Adaptive: broadband 1–5 GHz, up to 10 mesh refinement passes, Delta S 0.02
- Sweep: interpolating, 10 MHz – 10 GHz, 25 MHz step
- Cores: 4

### 4. Baseline qualification (precondition)

| Frequency | Insertion loss | Return loss |
|---|---|---|
| 0.01 GHz | −0.012 dB | −57.1 dB |
| 1 GHz | −0.157 dB | −25.2 dB |
| 5 GHz | −0.461 dB | −24.1 dB |
| 10 GHz | −0.754 dB | −40.7 dB |

Return loss stays better than −21.9 dB across the band, insertion loss is smooth
and monotonic with no resonances, and the energy budget is fully explained by
dielectric and conductor loss. **The baseline is valid.**

### 5. Pass criterion

Insertion-loss deviation from the baseline must stay within **0.5 dB** across the
whole band.

---

## Results

| Variant | Retained plane | Stitching vias | Result | Max IL deviation | RMS IL deviation |
|---|---|---|---:|---:|---:|
| Expansion 5 mm | 10.2 mm | Retained | PASS | 0.0166 dB | 0.0082 dB |
| Expansion 3 mm | 6.2 mm | Retained | PASS | 0.0174 dB | 0.0076 dB |
| Expansion 2 mm | 4.2 mm | Retained | PASS | 0.0274 dB | 0.0132 dB |
| Expansion 1 mm | 2.2 mm | **Removed** | **FAIL** | **1.6436 dB** | 0.7583 dB |
| **Control**: expansion 1 mm | 2.2 mm | **Retained** | PASS | **0.0392 dB** | 0.0233 dB |

### The decisive comparison

Same 1 mm expansion, same 2.2 mm retained plane width, the only difference being
whether the stitching vias survived:

| | Vias removed | Vias retained |
|---|---:|---:|
| Max IL deviation | 1.6436 dB | **0.0392 dB** |
| RMS IL deviation | 0.7583 dB | **0.0233 dB** |

**A 42× difference.** A plane as narrow as 2.2 mm is not a problem at all; losing
the stitching vias is.

---

## Why this demonstrates the method works

1. **The baseline is the same coupon.** Every comparison is "cut" against "uncut",
   so the difference can only come from the cutout.
2. **There is a negative control.** The 1 mm case shows what failure looks like,
   proving the measurement can distinguish good from bad.
3. **There is a variable-separating control.** The main experiment alone would
   wrongly suggest "the plane is too narrow"; fixing plane width and varying only
   via retention identifies the real cause.
4. **The baseline was qualified first.** Return loss better than −21.9 dB, no
   resonances.
5. **Raw data is published.** All Touchstone files and quantified results are
   included and can be recomputed independently.

---

## Practical guidance

- **Do not inflate the expansion distance "to be safe."** On this coupon, 2 mm and
  5 mm differ by 0.01 dB; over-expanding only enlarges the mesh and slows the solve
  without buying accuracy.
- **Before cutting, confirm the ground stitching vias alongside the channel will be
  retained.** The expansion must at least reach the nearest row of stitching vias
  (Y ±1.5 mm on this coupon, so expansion > 1.4 mm).
- This matches the
  [segmentation validation](../segmentation/segmentation_validation_report.md):
  both speed-ups have the same safety condition — **reference-plane stitching**.

---

## Raw data

- [Machine-readable JSON](results/cutout_validation_results.json)
- [Raw Touchstone files](results/touchstone/): baseline and cutout result for each
  variant

---

## Scope and further validation

This validation uses a single stripline coupon over a single band (0–10 GHz) with a
Bounding extent, one solve per condition and no repeatability statistics. Solver
accuracy is industry-standard Delta S 0.02, so the 0.02–0.04 dB residual includes
mesh numerical noise.

Microstrip has a more open field distribution and may require a different expansion
margin; it is outside this scope. ConvexHull extents, differential pairs, multiple
parallel traces (where a cutout severs crosstalk paths) and layout-cleanup
equivalence are likewise not covered here.

The public repository keeps only anonymized Touchstone files and static results;
PyEDB modelling and solve orchestration live in a restricted version.

> This toolkit is provided by Jeff Hong, Senior Technical Engineer at Taiwan
> Auto-Design Co. (TADC).

> This repository is Jeff Hong's personal technical portfolio. It is not an
> official product of Taiwan Auto-Design Co. (TADC) or Ansys, Inc. Ansys, HFSS and
> SIwave are trademarks of Ansys, Inc.
