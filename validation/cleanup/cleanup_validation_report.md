# Layout Cleanup Equivalence Validation Report

## Summary

This validation answers a concrete question: **after removing foreign-net copper
around a channel, do the channel's own S-parameters change — and how large a
protection distance is actually needed?**

Using a 40 × 20 mm symmetric stripline coupon with four pairs of floating
foreign-net clutter traces (±0.5, ±2.5, ±5.0 and ±8.0 mm from the channel):

- **Cleanup has no measurable effect on the channel.** The four protection
  distances give insertion-loss deviations of 0.0211, 0.0085, 0.0164 and
  0.0184 dB — all within **0.021 dB**.
- **Even removing clutter only 0.5 mm away changes nothing.** The most aggressive
  setting (0.3 mm guard, all 8 traces deleted) deviates by 0.0211 dB, no
  different in practice from the most conservative one.
- **There is no trend with protection distance** (0.0211 → 0.0085 → 0.0164 →
  0.0184), so what is being measured is mesh numerical noise.

The reason is straightforward: cleanup **protects the signal and reference nets**,
so the return path is never touched. What gets deleted is foreign-net metal, and a
stripline fully enclosed between two planes couples very weakly to it.

The conclusions apply to the model, bandwidth and solver settings in this report.
They are reproducible engineering evidence, not an unconditional guarantee for
every PCB stackup and structure.

![Cleanup validation overview](results/cleanup_validation_overview.svg)

---

## Method

### 1. What cleanup actually removes

The toolkit treats `protected_nets = signal nets ∪ reference nets` and **only
deletes copper and vias belonging to neither**. The question under test is
therefore not "what happens if the ground plane is removed" (that never happens)
but "what happens when foreign nets are removed".

Across every variant here the GND copper and all 42 ground stitching vias were
**retained in full**.

### 2. Coupon and variants

![Cleanup validation coupon and variants](results/cleanup_variants.svg)

| Item | Specification |
|---|---|
| Structure | Symmetric stripline (solid reference plane above and below) |
| Stackup | GND_TOP 35 µm / dielectric 250 µm / SIG 35 µm / dielectric 250 µm / GND_BOT 35 µm |
| Dielectric | εr = 4.0, tanδ = 0.005 |
| Channel under test | 0.2 mm wide, 38 mm long, component-end ports at both ends |
| Board / reference planes | 40 × 20 mm |
| Ground stitching vias | Y ±1.5 mm, 2 mm pitch (protected) |
| Clutter traces | 4 pairs at ±0.5 / ±2.5 / ±5.0 / ±8.0 mm, 24 mm long, each on its own net, **floating** |
| Cleanup mode | Conservative (level 1, fixed protection distance) |

The clutter traces are deliberately **floating** — floating conductors resonate
most readily, making this a conservative test. Real foreign nets are usually
terminated, which couples even less.

| Variant | Guard | Removed | Clutter kept |
|---|---|---|---|
| Baseline | — | 0 | all 4 pairs |
| Cleanup 0.3 mm | 0.3 mm | 8 traces | none |
| Cleanup 1.0 mm | 1.0 mm | 6 traces | ±0.5 mm |
| Cleanup 3.0 mm | 3.0 mm | 4 traces | ±0.5, ±2.5 mm |
| Cleanup 6.0 mm | 6.0 mm | 2 traces | ±0.5, ±2.5, ±5.0 mm |

### 3. Solver settings

Identical for every variant:

- Solver: Ansys HFSS 3D Layout 2026 R1
- Adaptive: broadband 1–5 GHz, up to 10 mesh refinement passes, Delta S 0.02
- Sweep: interpolating, 10 MHz – 10 GHz, 25 MHz step
- Cores: 4

### 4. Baseline qualification (precondition)

The baseline (all clutter retained) has a worst-case return loss of **−20.0 dB**
and −0.757 dB insertion loss at 10 GHz, smooth and monotonic with no resonances.
**It is a valid reference.**

### 5. Pass criterion

Insertion-loss deviation from the baseline must stay within **0.5 dB** across the
whole band.

---

## Results

| Variant | Removed | Kept | Result | Max IL deviation | RMS IL deviation | Max \|ΔS11\| |
|---|---|---|---:|---:|---:|---:|
| Cleanup 0.3 mm | 8 | none | PASS | 0.0211 dB | 0.0062 dB | 0.0412 |
| Cleanup 1.0 mm | 6 | ±0.5 | PASS | **0.0085 dB** | 0.0030 dB | 0.0092 |
| Cleanup 3.0 mm | 4 | ±0.5, ±2.5 | PASS | 0.0164 dB | 0.0074 dB | 0.0267 |
| Cleanup 6.0 mm | 2 | ±0.5, ±2.5, ±5.0 | PASS | 0.0184 dB | 0.0081 dB | 0.0290 |

All pass, and **the most aggressive cleanup is not the worst case** — 0.3 mm
(everything removed) at 0.0211 dB is indistinguishable from 6.0 mm (only the
farthest pair removed) at 0.0184 dB. The absence of any monotonic trend with
protection distance indicates the measurement is dominated by mesh numerical
noise rather than a physical effect of cleanup.

---

## Why this demonstrates the method works

1. **The baseline is the same coupon.** Every comparison is "cleaned" against
   "uncleaned", so the difference can only come from the removed metal.
2. **The extreme case is covered.** A 0.3 mm guard removes every clutter trace
   including the ±0.5 mm pair — the most aggressive setting the feature allows.
3. **The test conditions are conservative.** Floating clutter traces are the most
   prone to parasitic coupling and resonance.
4. **One variable at a time.** The five variants differ only in protection
   distance; stackup, materials, ports, stitching vias and solver settings are
   identical.
5. **Raw data is published.** All Touchstone files and quantified results are
   included and can be recomputed independently.

---

## Practical guidance

- **Cleanup can be used with confidence.** On this coupon, removing foreign-net
  metal as close as 0.5 mm changes the channel by less than 0.021 dB — far below
  any SI acceptance threshold.
- **There is no need to inflate the protection distance.** The four settings are
  indistinguishable; a larger guard only leaves more metal in the mesh.
- Read together with the [cutout](../cutout/cutout_validation_report.md) and
  [segmentation](../segmentation/segmentation_validation_report.md) validations:
  **of the three speed-ups, the only one that needs care is ground stitching at
  the cut or cutout boundary.** Removing foreign-net metal is not a risk.

---

## Raw data

- [Machine-readable JSON](results/cleanup_validation_results.json)
- [Raw Touchstone files](results/touchstone/): baseline and each protection
  distance

---

## Scope and further validation

This validation uses a single stripline coupon over a single band (0–10 GHz) in
conservative cleanup mode, one solve per condition and no repeatability
statistics. The 0.008–0.021 dB spread includes mesh numerical noise.

**A stripline is fully enclosed by its planes and couples weakly to external
metal; microstrip, with a single reference and a more open field, is likely to be
more sensitive to nearby metal** and was not separately measured here. The
level-2 (EM-range) cleanup mode, differential pairs, and terminated rather than
floating neighbours are also outside this scope.

The public repository keeps only anonymized Touchstone files and static results;
PyEDB modelling and solve orchestration live in a restricted version.

> This toolkit is provided by Jeff Hong, Senior Technical Engineer at Taiwan
> Auto-Design Co. (TADC).

> This repository is Jeff Hong's personal technical portfolio. It is not an
> official product of Taiwan Auto-Design Co. (TADC) or Ansys, Inc. Ansys, HFSS and
> SIwave are trademarks of Ansys, Inc.
