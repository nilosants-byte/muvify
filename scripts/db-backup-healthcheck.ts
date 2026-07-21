import "dotenv/config";
import { readdirSync, statSync } from "fs";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";
import { getBackupConfig } from "./db-utils";

function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function notifyWindows(title: string, message: string) {
  // Aviso nativo best-effort (balloon tip) - nao instala nada, so usa .NET
  // ja disponivel. Se falhar (ex: sem sessao interativa), so ignora.
  try {
    const script = `
Add-Type -AssemblyName System.Windows.Forms
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Icon = [System.Drawing.SystemIcons]::Warning
$notify.Visible = $true
$notify.ShowBalloonTip(15000, "${title.replace(/"/g, '`"')}", "${message.replace(/"/g, '`"')}", [System.Windows.Forms.ToolTipIcon]::Warning)
Start-Sleep -Seconds 16
$notify.Dispose()
`;
    spawnSync("powershell.exe", ["-NoProfile", "-Command", script], { stdio: "ignore", timeout: 20000 });
  } catch {
    // best-effort - health check nao pode falhar por causa do aviso
  }
}

export function checkBackupHealth() {
  const backup = getBackupConfig();
  const maxAgeHours = parseNumber(process.env.BACKUP_MAX_AGE_HOURS, 26);

  let files: string[];
  try {
    files = readdirSync(backup.dir).filter((entry) => entry.endsWith(".sql.enc"));
  } catch {
    files = [];
  }

  if (files.length === 0) {
    const message = `Nenhum backup encontrado em ${backup.dir}.`;
    console.error(`ALERTA BACKUP: ${message}`);
    notifyWindows("Backup do banco ausente", message);
    return false;
  }

  const newest = files
    .map((name) => ({ name, mtime: statSync(`${backup.dir}/${name}`).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)[0];

  const ageHours = (Date.now() - newest.mtime) / (60 * 60 * 1000);

  if (ageHours > maxAgeHours) {
    const message = `Backup mais recente (${newest.name}) tem ${ageHours.toFixed(1)}h - acima do limite de ${maxAgeHours}h. Verifique se o agendador esta rodando e se o Docker Desktop esta ativo.`;
    console.error(`ALERTA BACKUP: ${message}`);
    notifyWindows("Backup do banco desatualizado", message);
    return false;
  }

  console.log(`Backup OK: ${newest.name} (${ageHours.toFixed(1)}h atras, limite ${maxAgeHours}h).`);
  return true;
}

const isDirectRun = fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectRun) {
  const healthy = checkBackupHealth();
  process.exit(healthy ? 0 : 1);
}
