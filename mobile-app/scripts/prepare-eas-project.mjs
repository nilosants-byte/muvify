import fs from "node:fs";
import path from "node:path";

const appConfigPath = path.resolve(process.cwd(), "app.json");
const raw = fs.readFileSync(appConfigPath, "utf8");
const appConfig = JSON.parse(raw);

const envProjectId = process.env.MOBILE_EAS_PROJECT_ID?.trim();
const currentProjectId = appConfig?.expo?.extra?.eas?.projectId;

const finalProjectId = envProjectId || currentProjectId;

if (!finalProjectId) {
  console.error(
    "EAS projectId ausente. Configure MOBILE_EAS_PROJECT_ID no workflow ou adicione expo.extra.eas.projectId no app.json."
  );
  process.exit(1);
}

appConfig.expo = appConfig.expo || {};
appConfig.expo.extra = appConfig.expo.extra || {};
appConfig.expo.extra.eas = {
  ...(appConfig.expo.extra.eas || {}),
  projectId: finalProjectId
};

fs.writeFileSync(appConfigPath, `${JSON.stringify(appConfig, null, 2)}\n`, "utf8");
console.log(`EAS projectId pronto: ${finalProjectId}`);
