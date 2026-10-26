import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const LOCAL_XCCONFIG = resolve(import.meta.dir, "../../clients/ios/App/App/Config/Local.xcconfig");

function bundleId(): string {
  const local = existsSync(LOCAL_XCCONFIG) ? readFileSync(LOCAL_XCCONFIG, "utf8") : "";
  return /^HELLUM_BUNDLE_ID\s*=\s*(\S+)/m.exec(local)?.[1] ?? "com.example.hellum";
}

const LABEL = `${bundleId()}.bridge`;
const stateDir = process.env.HELLUM_STATE_DIR ?? join(homedir(), ".hellum");
const plistPath = join(homedir(), "Library", "LaunchAgents", `${LABEL}.plist`);
const entry = resolve(import.meta.dir, "../src/main.ts");

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(process.execPath)}</string>
    <string>run</string>
    <string>${escapeXml(entry)}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(stateDir)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HELLUM_STATE_DIR</key>
    <string>${escapeXml(stateDir)}</string>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(join(stateDir, "bridge.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(join(stateDir, "bridge.log"))}</string>
</dict>
</plist>
`;

await mkdir(stateDir, { recursive: true, mode: 0o700 });
await writeFile(plistPath, plist);
const uid = process.getuid?.() ?? 501;
await Bun.spawn(["launchctl", "bootout", `gui/${uid}/${LABEL}`], { stderr: "ignore" }).exited;
const bootstrap = Bun.spawn(["launchctl", "bootstrap", `gui/${uid}`, plistPath]);
if ((await bootstrap.exited) !== 0) {
  process.stderr.write(`launchctl bootstrap failed for ${plistPath}\n`);
  process.exit(1);
}
process.stdout.write(`Installed ${LABEL}. Logs: ${join(stateDir, "bridge.log")}\n`);
