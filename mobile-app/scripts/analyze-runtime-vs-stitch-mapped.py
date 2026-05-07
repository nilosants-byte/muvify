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

RUNTIME_TO_REFERENCE = {
    "02-auth-onboarding.png": {
        "dark": "onboarding_1_dark_gramado.png",
        "light": "onboarding_1_light_gramado.png",
    },
    "03-auth-login.png": {
        "dark": "login_dark_gramado.png",
        "light": "login_light_gramado.png",
    },
    "04-auth-register.png": {
        "dark": "cadastro_dark_gramado.png",
        "light": "cadastro_light_gramado.png",
    },
    "05-auth-forgot-password.png": {
        "dark": "recuperar_senha_dark_gramado.png",
        "light": "recuperar_senha_light_gramado.png",
    },
    "06-auth-session-expired.png": {
        "dark": "sess_o_expirada_dark_gramado.png",
        "light": "sess_o_expirada_light_gramado.png",
    },
    "07-auth-profile-selection.png": {
        "dark": "escolha_de_perfil_dark_gramado.png",
        "light": "escolha_de_perfil_light_gramado.png",
    },
    "08-client-home.png": {
        "dark": "home_aluno_dark_gramado.png",
        "light": "home_aluno_light_gramado.png",
    },
    "09-client-categories.png": {
        "dark": "categorias_dark_aluno.png",
        "light": "categorias_light_aluno.png",
    },
    "10-client-bookings.png": {
        "dark": "meus_agendamentos_dark.png",
        "light": "meus_agendamentos_light.png",
    },
    "11-client-favorites.png": {
        "dark": "favoritos_dark_aluno.png",
        "light": "favoritos_light_aluno.png",
    },
    "12-client-profile.png": {
        "dark": "meu_perfil_dark_aluno.png",
        "light": "meu_perfil_light_aluno.png",
    },
    "13-client-settings.png": {
        "dark": "configura_es_dark_aluno.png",
        "light": "configura_es_light_aluno.png",
    },
    "14-client-search.png": {
        "dark": "busca_dark_aluno.png",
        "light": "busca_light_aluno.png",
    },
    "15-client-professionals-list.png": {
        "dark": "lista_profissionais_dark_aluno.png",
        "light": "lista_profissionais_light_aluno.png",
    },
    "16-client-professional-detail.png": {
        "dark": "detalhe_profissional_dark.png",
        "light": "detalhe_profissional_light.png",
    },
    "17-client-create-booking.png": {
        "dark": "criar_agendamento_dark.png",
        "light": "criar_agendamento_light.png",
    },
    "18-client-booking-confirmation.png": {
        "dark": "confirma_o_agendamento_dark.png",
        "light": "confirma_o_agendamento_light.png",
    },
    "19-client-booking-detail.png": {
        "dark": "detalhe_agendamento_dark.png",
        "light": "detalhe_agendamento_light.png",
    },
    "20-client-confirm-completion.png": {
        "dark": "conclus_o_com_selfie_dark.png",
        "light": "conclus_o_com_selfie_light.png",
    },
    "21-client-review-professional.png": {
        "dark": "avaliar_profissional_dark.png",
        "light": "avaliar_profissional_light.png",
    },
    "22-shared-notifications.png": {
        "dark": "notifica_es_dark.png",
        "light": "notifica_es_light.png",
    },
    "23-shared-support.png": {
        "dark": "ajuda_e_suporte_dark.png",
        "light": "ajuda_e_suporte_light.png",
    },
    "24-shared-generic-error.png": {
        "dark": "erro_gen_rico_dark.png",
        "light": "erro_gen_rico_light.png",
    },
    "25-shared-offline-required.png": {
        "dark": "sem_internet_dark.png",
        "light": "sem_internet_light.png",
    },
    "26-provider-home.png": {
        "dark": "home_profissional_dark.png",
        "light": "home_profissional_light.png",
    },
    "27-provider-agenda.png": {
        "dark": "agenda_profissional_dark.png",
        "light": "agenda_profissional_light.png",
    },
    "28-provider-booking-detail.png": {
        "dark": "detalhe_atendimento_dark_profissional.png",
        "light": "detalhe_atendimento_light_profissional.png",
    },
    "29-provider-confirm-completion.png": {
        "dark": "conclus_o_com_selfie_dark_profissional.png",
        "light": "conclus_o_com_selfie_light_profissional.png",
    },
    "30-provider-booking-payment-status.png": {
        "dark": "status_de_pagamento_dark.png",
        "light": "status_de_pagamento_light.png",
    },
    "31-provider-profile-editor.png": {
        "dark": "perfil_profissional_dark.png",
        "light": "perfil_profissional_light.png",
    },
    "32-provider-availability-manager.png": {
        "dark": "disponibilidade_semanal_dark.png",
        "light": "disponibilidade_semanal_light.png",
    },
    "33-provider-connect-payout-account.png": {
        "dark": "conta_de_recebimento_dark_profissional.png",
        "light": "conta_de_recebimento_light_profissional.png",
    },
    "34-provider-payout-status.png": {
        "dark": "financeiro_dark_profissional.png",
        "light": "financeiro_light_profissional.png",
    },
}


def ensure_dir(path):
    os.makedirs(path, exist_ok=True)


def load_rgba(path):
    with Image.open(path) as im:
        return im.convert("RGBA")


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
                    if visited[ni] or pix[nx, ny] == 0:
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


def region_item_hint(region):
    if region.startswith("topo"):
        return "Header/topbar (logo, título, botões superiores)"
    if region.startswith("base"):
        return "Barra inferior/CTA principal"
    return "Conteúdo central (cards, formulários, listas, botões)"


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
        region = region_label(cx, cy, runtime_img.size[0], runtime_img.size[1])
        runtime_mean = crop_mean_rgb(runtime_img, bbox)
        ref_mean = crop_mean_rgb(ref_img, bbox)
        l_run = luminance_from_mean(runtime_mean)
        l_ref = luminance_from_mean(ref_mean)
        tone = "print mais claro" if l_run > l_ref + 2 else ("print mais escuro" if l_run < l_ref - 2 else "luminância semelhante")

        comp_details.append({
            "area": comp["area"],
            "bbox": bbox,
            "region": region,
            "item_hint": region_item_hint(region),
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


def main():
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    out_dir = os.path.join(OUT_ROOT, f"comparativo-mapeado-runtime-vs-stitch-{stamp}")
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
        entries = []
        runtime_files = sorted([f for f in os.listdir(runtime_dir) if f.lower().endswith('.png')])

        for runtime_file in runtime_files:
            runtime_path = os.path.join(runtime_dir, runtime_file)

            if runtime_file == "01-auth-splash-intro.png":
                entries.append({
                    "runtime_file": runtime_file,
                    "reference_file": None,
                    "analysis": {"note": "Splash sem equivalente direto no pacote stitch-screens"},
                })
                continue

            map_entry = RUNTIME_TO_REFERENCE.get(runtime_file)
            if not map_entry:
                entries.append({
                    "runtime_file": runtime_file,
                    "reference_file": None,
                    "analysis": {"note": "Sem mapeamento de referência"},
                })
                continue

            ref_file = map_entry[mode]
            ref_path = os.path.join(STITCH_DIR, ref_file)
            if not os.path.exists(ref_path):
                entries.append({
                    "runtime_file": runtime_file,
                    "reference_file": ref_file,
                    "analysis": {"note": "Arquivo de referência ausente"},
                })
                continue

            diff_artifact = os.path.join(diff_dir, mode, runtime_file)
            analysis = analyze_pair(runtime_path, ref_path, diff_artifact)
            entries.append({
                "runtime_file": runtime_file,
                "reference_file": ref_file,
                "analysis": analysis,
            })

        report["modes"][mode] = entries

        comparable = [e for e in entries if e.get("reference_file") and "diff_pixels_pct" in e.get("analysis", {})]
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
    md_lines.append("# Relatório mapeado: Runtime vs Stitch (pixel a pixel)\n")
    md_lines.append(f"Gerado em: `{report['generated_at']}`\n")

    for mode in ("dark", "light"):
        s = report["summary"].get(mode, {})
        md_lines.append(f"## Modo {mode}")
        md_lines.append(f"- Telas runtime: {s.get('runtime_total', 0)}")
        md_lines.append(f"- Telas comparáveis: {s.get('comparable_total', 0)}")
        md_lines.append(f"- Match pixel perfeito: {s.get('full_pixel_match_total', 0)}")
        md_lines.append(f"- Com diferenças: {s.get('mismatch_total', 0)}")
        md_lines.append("")

        for entry in report["modes"].get(mode, []):
            rf = entry["runtime_file"]
            ref = entry.get("reference_file")
            analysis = entry.get("analysis", {})

            md_lines.append(f"### {rf}")
            if not ref or "diff_pixels_pct" not in analysis:
                md_lines.append(f"- Referência: {ref if ref else '(não aplicável)'}")
                md_lines.append(f"- Observação: {analysis.get('note', 'sem dados')}\n")
                continue

            md_lines.append(f"- Referência Stitch: `{ref}`")
            md_lines.append(f"- Diferença de pixels: **{analysis['diff_pixels_pct']:.4f}%** ({analysis['diff_pixels']} px)")
            md_lines.append(f"- Diferença significativa: **{analysis['significant_diff_pixels_pct']:.4f}%** ({analysis['significant_diff_pixels']} px)")
            md_lines.append(f"- Tamanho print: `{analysis['runtime_size']}` | tamanho modelo: `{analysis['reference_size']}` | size_match: `{analysis['size_match']}`")
            md_lines.append(f"- Bounding box global da diferença: `{analysis['diff_bbox']}`")

            comps = analysis.get("components", [])
            if not comps:
                md_lines.append("- Componentes relevantes: nenhum acima do limiar")
            else:
                md_lines.append("- Componentes relevantes (top 6):")
                for idx, c in enumerate(comps, start=1):
                    md_lines.append(
                        f"  - [{idx}] região `{c['region']}` ({c['item_hint']}), área `{c['area']} px`, bbox `{c['bbox']}`, tom `{c['tone']}` (modelo {c['reference_luminance']} vs print {c['runtime_luminance']})"
                    )

            md_lines.append("")

    md_path = os.path.join(out_dir, "report-detalhado.md")
    with open(md_path, "w", encoding="utf-8") as f:
        f.write("\n".join(md_lines))

    print(json.dumps({
        "out_dir": out_dir,
        "json_report": json_path,
        "detailed_report": md_path,
        "summary": report["summary"],
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
