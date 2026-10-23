import { basename } from "node:path";
import { handleCron, type CronRequest } from "./fake-hermes-cron";
import { handleMemory, type MemoryRequest } from "./fake-hermes-memory";
import { handleSkills, type SkillsRequest } from "./fake-hermes-skills";
import { handleVoice, type VoiceRequest } from "./fake-hermes-voice";

const helper = basename(process.argv[2] ?? "", ".py");
const request: unknown = JSON.parse(await Bun.stdin.text());

switch (helper) {
  case "memory":
    process.stdout.write(JSON.stringify(handleMemory(request as MemoryRequest)));
    break;
  case "cron":
    process.stdout.write(JSON.stringify(handleCron(request as CronRequest)));
    break;
  case "skills":
    process.stdout.write(JSON.stringify(handleSkills(request as SkillsRequest)));
    break;
  case "voice":
    process.stdout.write(JSON.stringify(handleVoice(request as VoiceRequest)));
    break;
  default:
    process.stderr.write(`unknown helper ${helper}\n`);
    process.exit(2);
}
