import json
import os
from datetime import datetime
from PIL import Image, ImageChops, ImageStat

RUNTIME_DIRS = {
    "dark": r"C:\Users\Danilo\Documents\testes app\muvify-prints-dark",
    "light": r"C:\Users\Danilo\Documents\testes app\muvify-prints-light-runtime",
}
STITCH_DIR = r"C:\Users\Danilo\Documents\dev\personal-app-backend\mobile-app\assets\stitch-screens"
OUT_ROOT = r"C:\Users\Danilo\Documents\testes app"


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def list_runtime_pngs(mode_dir):
    files = [f for f in os.listdir(mode_dir) if f.lower().endswith('.png')]
    files.sort()
    return files


def list_stitch_pngs(mode):
    suffix = f"_{mode}.png"
    files = [f for f in os.listdir(STITCH_DIR) if f.lower().endswith(suffix)]
    files.sort()
    return files


def load_rgba(path):
    with Image.open(path) as im:
        return im.convert("RGBA")


def mean_abs_diff(img_a, img_b):
    if img_a.size != img_b.size:
        img_b = img_b.resize(img_a.size, Image.Resampling.BILINEAR)
    diff = ImageChops.difference(img_a, img_b)
    st = ImageStat.Stat(diff)
    return sum(st.mean) / len(st.mean)


def mask_from_diff(diff_img, threshold=12):
    g = diff_img.convert("L")
    return g.point(lambda p: 255 if p > threshold else 0, mode="L")


def nonzero_ratio(mask_img):
    hist = mask_img.histogram()
    total = mask_img.size[0] * mask_img.size[1]
    zeros = hist[0]
    nz = total - zeros
    return nz, total, (nz / total * 100.0 if total else 0.0)


def connected_components(mask_img, min_area=40):
    w, h = mask_img.size
    pix = mask_img.load()
    visited = bytearray(w * h)
    comps = []

    def idx(x, y):
        return y * w + x

    for y in range(h):
        for x in range(w):
            if pix[x, y] == 0:
                continue
            i = idx(x, y)
            if visited[i]:
                continue

            stack = [(x, y)]
            visited[i] = 1
            area = 0
            min_x = max_x = x
            min_y = max_y = y

            while stack:
                cx, cy = stack.pop()
                area += 1
                if cx < min_x:
                    min_x = cx
                if cx > max_x:
                    max_x = cx
                if cy < min_y:
                    min_y = cy
                if cy > max_y:
                    max_y = cy

                for nx, ny in ((cx - 1, cy), (cx + 1, cy), (cx, cy - 1), (cx, cy + 1)):
                    if nx < 0 or ny < 0 or nx >= w or ny >= h:
                        continue
                    ni = idx(nx, ny)
                    if visited[ni]:
                        continue
                    if pix[nx, ny] == 0:
                        continue
                    visited[ni] = 1
                    stack.append((nx, ny))

            if area >= min_area:
                comps.append({
                    "area": area,
                    "bbox": [min_x, min_y, max_x + 1, max_y + 1],
                    "center": [(min_x + max_x) / 2.0, (min_y + max_y) / 2.0],
                })

    comps.sort(key=lambda c: c["area"], reverse=True)
    return comps


def region_label(center_x, center_y, width, height):
    if center_y < height / 3:
        v = "topo"
    elif center_y < 2 * height / 3:
        v = "meio"
    else:
        v = "base"

    if center_x < width / 3:
        h = "esquerda"
    elif center_x < 2 * width / 3:
        h = "centro"
    else:
        h = "direita"

    return f"{v}-{h}"


def luminance_from_mean(rgb_mean):
    r, g, b = rgb_mean
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def crop_mean_rgb(img, bbox):
    x1, y1, x2, y2 = bbox
    if x2 <= x1 or y2 <= y1:
        return (0.0, 0.0, 0.0)
    crop = img.crop((x1, y1, x2, y2)).convert("RGB")
    st = ImageStat.Stat(crop)
    return tuple(st.mean)


def analyze_pair(runtime_path, ref_path, diff_artifact_path):
    runtime_img = load_rgba(runtime_path)
    ref_img = load_rgba(ref_path)

    size_match = runtime_img.size == ref_img.size
    if not size_match:
        ref_img = ref_img.resize(runtime_img.size, Image.Resampling.BILINEAR)

    diff = ImageChops.difference(runtime_img, ref_img)
    diff_bbox = diff.getbbox()

    mask_any = mask_from_diff(diff, threshold=0)
    nz_any, total, pct_any = nonzero_ratio(mask_any)

    mask_sig = mask_from_diff(diff, threshold=12)
    nz_sig, _, pct_sig = nonzero_ratio(mask_sig)

    comps = connected_components(mask_sig, min_area=50)

    comp_details = []
    for comp in comps[:6]:
        bbox = comp["bbox"]
        cx, cy = comp["center"]
        runtime_mean = crop_mean_rgb(runtime_img, bbox)
        ref_mean = crop_mean_rgb(ref_img, bbox)
        l_run = luminance_from_mean(runtime_mean)
        l_ref = luminance_from_mean(ref_mean)
        tone = "runtime mais claro" if l_run > l_ref + 2 else ("runtime mais escuro" if l_run < l_ref - 2 else "luminância semelhante")
        comp_details.append({
            "area": comp["area"],
            "bbox": bbox,
            "region": region_label(cx, cy, runtime_img.size[0], runtime_img.size[1]),
            "runtime_luminance": round(l_run, 2),
            "reference_luminance": round(l_ref, 2),
            "tone": tone,
        })

    ensure_dir(os.path.dirname(diff_artifact_path))
    diff.convert("RGB").save(diff_artifact_path)

    return {
        "size_match": size_match,
        "runtime_size": list(runtime_img.size),
        "reference_size": list(ref_img.size),
        "diff_bbox": list(diff_bbox) if diff_bbox else None,
        "diff_pixels": nz_any,
        "diff_pixels_pct": round(pct_any, 4),
        "significant_diff_pixels": nz_sig,
        "significant_diff_pixels_pct": round(pct_sig, 4),
        "components": comp_details,
    }


def best_reference(runtime_img, ref_candidates):
    best = None
    top = []
    for ref_name, ref_img in ref_candidates:
        score = mean_abs_diff(runtime_img, ref_img)
        top.append((ref_name, score))
        if best is None or score < best[1]:
            best = (ref_name, score)

    top.sort(key=lambda t: t[1])
    return best, top[:3]


def main():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(OUT_ROOT, f"comparativo-runtime-vs-stitch-{stamp}")
    diff_dir = os.path.join(out_dir, "diffs")
    ensure_dir(diff_dir)

    report = {
        "generated_at": datetime.now().isoformat(),
        "runtime_dirs": RUNTIME_DIRS,
        "stitch_dir": STITCH_DIR,
        "modes": {},
        "summary": {},
    }

    for mode, runtime_dir in RUNTIME_DIRS.items():
        runtime_files = list_runtime_pngs(runtime_dir)
        stitch_files = list_stitch_pngs(mode)

        ref_candidates = []
        for ref in stitch_files:
            ref_path = os.path.join(STITCH_DIR, ref)
            ref_candidates.append((ref, load_rgba(ref_path)))

        mode_entries = []

        for runtime_file in runtime_files:
            runtime_path = os.path.join(runtime_dir, runtime_file)
            runtime_img = load_rgba(runtime_path)

            # Splash não existe no pacote stitch-screens
            if runtime_file.lower().startswith("01-auth-splash-intro"):
                mode_entries.append({
                    "runtime_file": runtime_file,
                    "matched_reference": None,
                    "match_score_mean_abs_diff": None,
                    "top3_candidates": [],
                    "analysis": {
                        "note": "Tela de splash sem equivalente direto no pacote stitch-screens"
                    },
                })
                continue

            best, top3 = best_reference(runtime_img, ref_candidates)
            best_ref_name, best_score = best
            best_ref_path = os.path.join(STITCH_DIR, best_ref_name)

            diff_artifact_path = os.path.join(diff_dir, mode, runtime_file)
            analysis = analyze_pair(runtime_path, best_ref_path, diff_artifact_path)

            mode_entries.append({
                "runtime_file": runtime_file,
                "matched_reference": best_ref_name,
                "match_score_mean_abs_diff": round(best_score, 4),
                "top3_candidates": [
                    {"reference": name, "mean_abs_diff": round(score, 4)}
                    for name, score in top3
                ],
                "analysis": analysis,
            })

        report["modes"][mode] = mode_entries

        comparable = [e for e in mode_entries if e["matched_reference"]]
        full_match = [
            e for e in comparable
            if e["analysis"]["diff_pixels_pct"] == 0.0 and e["analysis"]["size_match"]
        ]

        report["summary"][mode] = {
            "runtime_total": len(runtime_files),
            "comparable_total": len(comparable),
            "full_pixel_match_total": len(full_match),
            "mismatch_total": len(comparable) - len(full_match),
        }

    json_path = os.path.join(out_dir, "report.json")
    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(report, f, ensure_ascii=False, indent=2)

    md_lines = []
    md_lines.append("# Comparativo Runtime vs Stitch (pixel a pixel)\n")
    md_lines.append(f"Gerado em: `{report['generated_at']}`\n")
    md_lines.append("")

    for mode in ("dark", "light"):
        s = report["summary"].get(mode, {})
        md_lines.append(f"## Modo {mode}")
        md_lines.append(f"- Telas runtime: {s.get('runtime_total', 0)}")
        md_lines.append(f"- Telas comparáveis: {s.get('comparable_total', 0)}")
        md_lines.append(f"- Match pixel perfeito: {s.get('full_pixel_match_total', 0)}")
        md_lines.append(f"- Com diferenças: {s.get('mismatch_total', 0)}")
        md_lines.append("")

        md_lines.append("| Tela runtime | Referência Stitch (best match) | Dif. px (%) | Dif. significativa (%) | Região principal |")
        md_lines.append("|---|---|---:|---:|---|")

        for entry in report["modes"].get(mode, []):
            rf = entry["runtime_file"]
            ref = entry["matched_reference"]
            if not ref:
                md_lines.append(f"| {rf} | (sem equivalente direto) | - | - | - |")
                continue
            an = entry["analysis"]
            reg = an["components"][0]["region"] if an.get("components") else "sem componente relevante"
            md_lines.append(
                f"| {rf} | {ref} | {an['diff_pixels_pct']:.4f} | {an['significant_diff_pixels_pct']:.4f} | {reg} |"
            )

        md_lines.append("")

    md_path = os.path.join(out_dir, "report.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print(json.dumps({
        "out_dir": out_dir,
        "json_report": json_path,
        "md_report": md_path,
        "summary": report["summary"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
