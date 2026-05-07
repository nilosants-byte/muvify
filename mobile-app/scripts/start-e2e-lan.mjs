import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

function isPrivateIpv4(address) {
  return (
    /^10\./.test(address) ||
    /^192\.168\./.test(address) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(address)
  );
}

function resolveLanIpv4() {
  const interfaces = os.networkInterfaces();
  for (const values of Object.values(interfaces)) {
    if (!values) continue;
    for (const item of values) {
      if (item.family !== "IPv4" || item.internal) continue;
      if (isPrivateIpv4(item.address)) {
        return item.address;
      }
    }
  }
  return "127.0.0.1";
}

const hostIp = resolveLanIpv4();
const apiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL || `http://${hostIp}:3000/api`;

process.env.REACT_NATIVE_PACKAGER_HOSTNAME = hostIp;
process.env.EXPO_NO_DEPENDENCY_VALIDATION = "true";
process.env.EXPO_PACKAGER_PROXY_URL = `http://${hostIp}:8081`;
process.env.EXPO_PUBLIC_API_BASE_URL = apiBaseUrl;

console.log(`[start:e2e:lan] REACT_NATIVE_PACKAGER_HOSTNAME=${hostIp}`);
console.log("[start:e2e:lan] EXPO_NO_DEPENDENCY_VALIDATION=true");
console.log(`[start:e2e:lan] EXPO_PACKAGER_PROXY_URL=http://${hostIp}:8081`);
console.log(`[start:e2e:lan] EXPO_PUBLIC_API_BASE_URL=${apiBaseUrl}`);

const expoArgs = ["start", "--go", "--host", "lan", "--port", "8081", "-c"];
const localExpoBin = process.platform === "win32"
  ? path.join(process.cwd(), "node_modules", ".bin", "expo.cmd")
  : path.join(process.cwd(), "node_modules", ".bin", "expo");

const child = fs.existsSync(localExpoBin)
  ? process.platform === "win32"
    ? spawn("cmd.exe", ["/c", `${localExpoBin} ${expoArgs.join(" ")}`], {
        stdio: "inherit",
        env: process.env
      })
    : spawn(localExpoBin, expoArgs, {
        stdio: "inherit",
        env: process.env
      })
  : process.platform === "win32"
    ? spawn("cmd.exe", ["/c", `npx expo ${expoArgs.join(" ")}`], {
        stdio: "inherit",
        env: process.env
      })
    : spawn("npx", ["expo", ...expoArgs], {
        stdio: "inherit",
        env: process.env
      });

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
