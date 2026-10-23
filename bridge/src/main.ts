import { loadConfig } from "./config";
import { log } from "./log";
import { startBridge } from "./server";

const bridge = startBridge(loadConfig(process.env));
log.info("bridge listening", { url: bridge.url.toString() });
