/**
 * check-store-assets.mjs
 *
 * Verifica as dimensões dos assets existentes e lista o que ainda falta
 * para submissão nas lojas (App Store e Google Play).
 *
 * Uso:
 *   node scripts/check-store-assets.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(__dirname, "..", "assets");

// Lê largura e altura de um PNG sem dependências externas.
// O header PNG tem: 8 bytes de assinatura, 4 bytes de comprimento do chunk IHDR,
// 4 bytes "IHDR", 4 bytes de largura, 4 bytes de altura.
function pngDimensions(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    const sig = buf.slice(0, 8);
    const isPng =
      sig[0] === 0x89 && sig[1] === 0x50 && sig[2] === 0x4e && sig[3] === 0x47;
    if (!isPng) return null;
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    return { w, h };
  } catch {
    return null;
  }
}

function checkAsset(label, filePath, required) {
  const exists = fs.existsSync(filePath);
  if (!exists) {
    console.log(`  ✗ ${label}: FALTANDO`);
    return false;
  }
  const dim = pngDimensions(filePath);
  const dimStr = dim ? `${dim.w}×${dim.h}` : "dimensão desconhecida";
  const sizeKB = (fs.statSync(filePath).size / 1024).toFixed(0);

  if (required && dim) {
    const ok = dim.w === required.w && dim.h === required.h;
    if (ok) {
      console.log(`  ✓ ${label}: ${dimStr} (${sizeKB}KB)`);
    } else {
      console.log(
        `  ⚠ ${label}: ${dimStr} (${sizeKB}KB) — esperado ${required.w}×${required.h}`
      );
    }
    return ok;
  }

  console.log(`  ✓ ${label}: ${dimStr} (${sizeKB}KB)`);
  return true;
}

function countScreenshots(dir) {
  if (!fs.existsSync(dir)) return 0;
  return fs.readdirSync(dir).filter((f) => f.endsWith(".png") || f.endsWith(".jpg")).length;
}

// ─────────────────────────────────────────────────────────────────────────────

console.log("\n╔══════════════════════════════════════════════════════╗");
console.log("║       VERIFICAÇÃO DE ASSETS — MUVIFY STORES          ║");
console.log("╚══════════════════════════════════════════════════════╝\n");

// ── Ícones ────────────────────────────────────────────────────────────────────
console.log("📱 ÍCONES DO APP");
console.log("─────────────────────────────────────────────────────");
checkAsset(
  "icon.png (iOS + Android base — 1024×1024)",
  path.join(ASSETS, "icon.png"),
  { w: 1024, h: 1024 }
);
checkAsset(
  "favicon.png (web — 32×32)",
  path.join(ASSETS, "favicon.png"),
  { w: 32, h: 32 }
);
// Android adaptive icons: 512×512 é aceitável; 1024×1024 é ideal mas não obrigatório
checkAsset(
  "android-icon-foreground.png (adaptive, mín 512×512)",
  path.join(ASSETS, "android-icon-foreground.png")
);
checkAsset(
  "android-icon-background.png (adaptive, mín 512×512)",
  path.join(ASSETS, "android-icon-background.png")
);
checkAsset(
  "android-icon-monochrome.png (themed)",
  path.join(ASSETS, "android-icon-monochrome.png")
);

// ── Splash screens ─────────────────────────────────────────────────────────
console.log("\n🌅 SPLASH SCREENS");
console.log("─────────────────────────────────────────────────────");
checkAsset(
  "splash-icon.png (logo no splash, 200×200 min)",
  path.join(ASSETS, "splash-icon.png")
);
checkAsset(
  "splash/splash-light.png (modo claro)",
  path.join(ASSETS, "splash", "splash-light.png")
);
checkAsset(
  "splash/splash-dark.png (modo escuro)",
  path.join(ASSETS, "splash", "splash-dark.png")
);

// ── Screenshots já capturadas ─────────────────────────────────────────────
console.log("\n📸 SCREENSHOTS CAPTURADAS");
console.log("─────────────────────────────────────────────────────");
const dirs = [
  ["stitch-44-dark", "stitch-44-dark"],
  ["stitch-screens", "stitch-screens"],
  ["stitch-44-runtime-dark", "stitch-44-runtime-dark"],
];
for (const [label, dir] of dirs) {
  const count = countScreenshots(path.join(ASSETS, dir));
  const status = count > 0 ? "✓" : "✗";
  console.log(`  ${status} ${label}: ${count} arquivo(s)`);
}

// ── Verificação de screenshots para lojas ──────────────────────────────────
console.log("\n🔍 SCREENSHOTS ESPECÍFICAS PARA LOJAS");
console.log("─────────────────────────────────────────────────────");

// App Store exige screenshots em resoluções específicas.
// Verificamos se existe pelo menos uma screenshot de cada tamanho.
const storeScreens = [
  {
    label: 'App Store — iPhone 6.7" (1290×2796)',
    dir: path.join(ASSETS, "store", "ios", "iphone67"),
    required: { w: 1290, h: 2796 },
  },
  {
    label: 'App Store — iPhone 6.5" (1284×2778)',
    dir: path.join(ASSETS, "store", "ios", "iphone65"),
    required: { w: 1284, h: 2778 },
  },
  {
    label: "Google Play — Feature Graphic (1024×500)",
    file: path.join(ASSETS, "store", "google-play-feature.png"),
    required: { w: 1024, h: 500 },
  },
  {
    label: "Google Play — Screenshots (min 2)",
    dir: path.join(ASSETS, "store", "android"),
    minCount: 2,
  },
];

for (const item of storeScreens) {
  if (item.file) {
    checkAsset(item.label, item.file, item.required);
  } else if (item.dir) {
    const count = fs.existsSync(item.dir)
      ? fs.readdirSync(item.dir).filter((f) => /\.(png|jpg)$/.test(f)).length
      : 0;
    const minOk = !item.minCount || count >= item.minCount;
    const status = count > 0 && minOk ? "✓" : "✗";
    const note = item.minCount ? ` (mínimo ${item.minCount})` : "";
    console.log(`  ${status} ${item.label}: ${count} arquivo(s)${note}`);
  }
}

// ── Google Play: Feature Graphic ────────────────────────────────────────────
console.log("\n📋 RESUMO E PRÓXIMAS ETAPAS");
console.log("─────────────────────────────────────────────────────");

const iconOk = fs.existsSync(path.join(ASSETS, "icon.png"));
const splashOk =
  fs.existsSync(path.join(ASSETS, "splash", "splash-dark.png")) &&
  fs.existsSync(path.join(ASSETS, "splash", "splash-light.png"));
const screenshotsExist = countScreenshots(path.join(ASSETS, "stitch-44-dark")) > 0;
const storeDir = path.join(ASSETS, "store");
const storeDirExists = fs.existsSync(storeDir);

if (iconOk) console.log("  ✓ Ícone principal: pronto");
else console.log("  ✗ Ícone principal: criar icon.png 1024×1024");

if (splashOk) console.log("  ✓ Splash screens: prontas");
else console.log("  ✗ Splash screens: criar splash-light.png e splash-dark.png");

if (screenshotsExist) {
  console.log("  ✓ Screenshots brutas capturadas: prontas para edição");
  console.log("    → Próximo passo: redimensionar para os tamanhos das lojas");
  console.log("    → Ver guia: STORE_ASSETS_GUIDE.md");
}

if (!storeDirExists) {
  console.log("  ✗ Pasta assets/store/ não existe — criar e adicionar assets finalizados");
}

console.log("\n  Guia completo: mobile-app/STORE_ASSETS_GUIDE.md\n");
