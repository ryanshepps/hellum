import { loadConfig } from "./config";
import { log } from "./log";
import { startBridge } from "./server";

const bridge = await startBridge(loadConfig(process.env));
log.info("bridge listening", { url: bridge.url.toString(), adminSocket: bridge.adminSocketPath });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void bridge.stop().then(() => process.exit(0));
  });
}
