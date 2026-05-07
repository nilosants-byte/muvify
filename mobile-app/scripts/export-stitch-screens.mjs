import fs from "node:fs";
import path from "node:path";

const sourceRoot =
  "C:/Users/Danilo/Documents/testes app/design/stitch_onboarding_2_dark/stitch_onboarding_2_dark";
const darkOut = "C:/Users/Danilo/Documents/testes app/muvify-prints-stitch-dark";
const lightOut = "C:/Users/Danilo/Documents/testes app/muvify-prints-stitch-light";

function ensureCleanPngDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const entry of fs.readdirSync(dir)) {
    if (entry.toLowerCase().endsWith(".png")) {
      fs.unlinkSync(path.join(dir, entry));
    }
  }
}

function copyTheme(themeToken, outDir) {
  const dirEntries = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.includes(themeToken))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, "pt-BR"));

  let index = 1;
  for (const dirName of dirEntries) {
    const sourcePng = path.join(sourceRoot, dirName, "screen.png");
    if (!fs.existsSync(sourcePng)) {
      continue;
    }

    const fileName = `${String(index).padStart(2, "0")}-${dirName}.png`;
    fs.copyFileSync(sourcePng, path.join(outDir, fileName));
    index += 1;
  }

  return index - 1;
}

function main() {
  ensureCleanPngDir(darkOut);
  ensureCleanPngDir(lightOut);

  const darkCount = copyTheme("_dark", darkOut);
  const lightCount = copyTheme("_light", lightOut);

  // eslint-disable-next-line no-console
  console.log(`Export concluído: dark=${darkCount} light=${lightCount}`);
}

main();
