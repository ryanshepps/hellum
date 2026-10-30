import { basename } from "node:path";
import { handleCron, type CronRequest } from "./fake-hermes-cron";
import { handleMcp, type McpRequest } from "./fake-hermes-mcp";
import { handleMemory, type MemoryRequest } from "./fake-hermes-memory";
import { handleModels, type ModelsRequest } from "./fake-hermes-models";
import { handleSessions, type SessionsRequest } from "./fake-hermes-sessions";
import { handleSettings, type SettingsRequest } from "./fake-hermes-settings";
import { handleSkills, type SkillsRequest } from "./fake-hermes-skills";
import { handleUsage } from "./fake-hermes-usage";
import { handleVoice, type VoiceRequest } from "./fake-hermes-voice";

const helper = basename(process.argv[2] ?? "", ".py");
const request: unknown = JSON.parse(await Bun.stdin.text());

switch (helper) {
  case "mcp":
    process.stdout.write(JSON.stringify(handleMcp(request as McpRequest)));
    break;
  case "memory":
    process.stdout.write(JSON.stringify(handleMemory(request as MemoryRequest)));
    break;
  case "cron":
    process.stdout.write(JSON.stringify(handleCron(request as CronRequest)));
    break;
  case "skills":
    process.stdout.write(JSON.stringify(handleSkills(request as SkillsRequest)));
    break;
  case "models":
    process.stdout.write(JSON.stringify(handleModels(request as ModelsRequest)));
    break;
  case "sessions":
    process.stdout.write(JSON.stringify(handleSessions(request as SessionsRequest)));
    break;
  case "settings":
    process.stdout.write(JSON.stringify(handleSettings(request as SettingsRequest)));
    break;
  case "usage":
    process.stdout.write(JSON.stringify(handleUsage()));
    break;
  case "voice":
    process.stdout.write(JSON.stringify(handleVoice(request as VoiceRequest)));
    break;
  default:
    process.stderr.write(`unknown helper ${helper}\n`);
    process.exit(2);
}
