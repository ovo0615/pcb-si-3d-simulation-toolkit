# Solver and Segmentation Studies: Four Investigations

> Conducted 2026-08-11 to 2026-08-12. Purpose-built coupons, AEDT 2026.1,
> 4 cores. Raw Touchstone data included.
>
> 繁體中文版：[分段與求解器研究總覽](分段與求解器研究總覽.md)

## The short version

**These four studies exist to audit the tool itself. All four found a problem,
and all four problems were fixed.**

| What was found | What it became |
|---|---|
| The old cut-quality check passed a cut with **21.9 dB of error** | Replaced with "stitch pitch ≤ one tenth of a wavelength" |
| That new rule had only been calibrated on one stackup | Re-validated across materials and thicknesses; all five cases conservative |
| The solver-assignment score had no measured basis | Measured SIwave's actual deviation on each structure type |
| The default solve setup **under-reported loss by 3.2 dB** at high frequency | Adaptive range widened to cover the whole sweep |

**The common finding: what decides accuracy is the return path, not how complex
the geometry looks.**

Full data and method for each study below.

---

## Why these studies exist

Two decisions inside the segmentation feature had **never been quantitatively
validated**:

1. **How cut quality is judged** — `segment.py` used "at least 2 reference vias
   within 3 mm of the crossing". Those two constants were engineering judgement,
   not measurement.
2. **How solvers are assigned** — a complexity score decides which segment goes
   to SIwave and which to HFSS. Its thresholds had no empirical basis either.

These studies replace both with data. Along the way they also found that the
HFSS adaptive default under-converges near the top of the sweep.

## The four studies

| # | Study | Finding | Change made |
|---|---|---|---|
| 1 | [Adaptive range](solver_mix/自適應範圍驗證報告.md) | The old BKM (1 GHz → Fmax/2) **under-reports loss by 3.2 dB** at 20 GHz | `broadband_range_ghz()` now spans the whole sweep |
| 2 | [Cut stitching density](stitch_density/切面縫合密度驗證報告.md) | Old rule **passed a cut with 21.9 dB cascade error** | Replaced with a λ/N spacing rule |
| 3 | [SIwave applicability](solver_map/SIwave適用性地圖.md) | Bends are **not** a SIwave weakness; open stubs are | Bend count no longer raises the complexity score |
| 4 | [Cross-stackup transfer](stitch_transfer/跨疊構轉移性驗證報告.md) | The λ/N rule holds across εr and thickness | Fraction set to 12 for margin |

## Headline numbers

**Study 1 — adaptive range.** Same coupon, same 0.01–20 GHz sweep, only the
adaptive setting changed. Insertion loss at 20 GHz:

| Adaptive setting | Solve time | IL @ 20 GHz | vs converged |
|---|---:|---:|---:|
| Broadband 1–10 GHz (old default) | 6.5 min | −2.498 dB | **+3.208 dB** |
| Broadband 1–20 GHz | 12.8 min | −5.910 dB | −0.203 dB |
| Single frequency 20 GHz | 24.0 min | −5.707 dB | reference |

The two converged settings agree within 0.2 dB, and broadband takes half the
time of single-frequency. Note the trap: the under-converged result *looks*
better (less loss) and sits closer to SIwave, which makes it easy to conclude
the wrong thing.

**Study 2 — stitching density.** Same geometry, only the stitching via pitch
changed. Cut at mid-board, two segments cascaded and compared against the same
solver's monolithic result:

| Pitch | Vias within 3 mm | Old rule | Max deviation | Usable to |
|---:|---:|---|---:|---:|
| 1 mm | 10 | pass | 0.119 dB | 11.50 GHz |
| 2 mm | 6 | pass | 0.708 dB | 7.71 GHz |
| **4 mm** | **2** | **pass** ⚠ | **21.949 dB** | 6.39 GHz |
| 8 mm | 0 | reject | 12.949 dB | 3.78 GHz |
| none | 0 | reject | 20.016 dB | 3.26 GHz |

4 mm pitch places exactly one via pair inside the search radius — just enough to
satisfy "at least 2" — while producing a 21.9 dB error. Cross-checked with HFSS:
both solvers show the same trend, with HFSS consistently stricter.

**Study 3 — SIwave applicability.** Four structures, identical stackup, ports
and stitching; only the middle geometry differs. Reference is converged HFSS:

| Structure | 0–5 GHz | 5–10 GHz | 10–20 GHz | SIwave trustworthy to | Speedup |
|---|---:|---:|---:|---:|---:|
| Straight | 0.016 | 0.012 | 0.123 | full band | 138× |
| Detour, four right-angle bends | 0.015 | 0.010 | 0.290 | full band | 122× |
| 3 mm open stub | 0.163 | 1.025 | **3.958** | **7.1 GHz** | 113× |
| Reference-plane split crossing | 0.039 | 0.284 | 0.783 | 13.6 GHz | 129× |

Counter-intuitively the **stub fails earlier than the plane split**: its λ/4
resonance sits near 12.5 GHz, and small differences near a deep notch are
amplified into several dB.

**Study 4 — cross-stackup transfer.** Fixed 2 mm pitch, trace width recomputed
for 50 Ω in each stackup:

| Stackup | Predicted | Measured | Margin |
|---|---:|---:|---:|
| εr 4.0 / 250 µm | 6.91 GHz | 7.71 GHz | 10.5% |
| εr 3.0 / 250 µm | 7.97 GHz | 8.53 GHz | 6.5% |
| εr 6.0 / 250 µm | 5.64 GHz | 6.41 GHz | 12.1% |
| εr 4.0 / 150 µm | 6.91 GHz | 7.10 GHz | 2.7% |
| εr 4.0 / 400 µm | 6.91 GHz | 7.01 GHz | 1.5% |

The √εr scaling is correct (measured × √εr gives 14.77 / 15.43 / 15.70, within
6%). Thickness can be omitted (±5%, no monotonic trend). But margin narrows to
1.5% for thick boards, so the wavelength fraction was set to 12 rather than the
conventional 10 — because the failure costs are asymmetric: passing a bad cut
produces a 20 dB error the user will not notice, while being too strict merely
costs a few extra stitching vias.

## The theme running through all four

Not a premise — the data kept pointing at the same place:

- Stitching pitch from 1 mm to 4 mm: cascade error 0.119 dB → 21.9 dB
- A failed coupon revision: moving stitching vias from 1.5 mm to 6 mm away from
  a **plain straight trace** widened the SIwave/HFSS gap from 0.7 dB to 8.0 dB
- What breaks SIwave is return-path disruption and resonance, not geometric
  complexity
- Earlier segmentation and cutout validations reached the same conclusion

Four independent experiments, different coupons, different solvers — all
converging on reference-plane stitching as the dominant factor.

## Method lessons worth keeping

1. **Before treating HFSS as truth, confirm the adaptive range covers the band
   you are comparing.** An earlier conclusion ("SIwave is unreliable at high
   frequency") was wrong because the reference itself had not converged.
2. **Before committing to a long solve, check DC continuity with a 30-second
   SIwave run.** A connected line must show S21 ≈ 0 dB and a deeply negative S11
   at 10 MHz. This gate caught three broken coupons that would each have wasted
   an 80-minute HFSS solve.
3. **A control determines whether a conclusion stands.** Without an
   all-HFSS-segmented control, cut-construction error would have been
   misattributed to solver assignment.
4. **Watchdogs should detect stalls, not elapsed time.** A fixed timeout fails
   both ways: too short kills nearly-finished solves (45 minutes lost in
   practice), too long wastes an hour on a hang.

## Raw data

Every study folder contains `results/`: machine-readable JSON, SVG figures, and
anonymized Touchstone files, plus the modelling and solve-orchestration scripts.

> This repository is Jeff Hong's personal technical portfolio. It is not an
> official product of Taiwan Auto-Design Co. (TADC) or Ansys, Inc. Ansys, HFSS
> and SIwave are trademarks of Ansys, Inc.
