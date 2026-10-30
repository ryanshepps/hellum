import { accentHexForColorId } from "@vellumai/avatar-catalog/colors";
import { getCharacterComponents } from "@vellumai/avatar-catalog";
import {
  AVATAR_IMAGE_FILENAME,
  AVATAR_MANIFEST_FILENAME,
  AVATAR_TRAITS_FILENAME,
  dominantAccentHex,
  parseAvatarManifest,
  type AvatarAccent,
  type AvatarState,
  type CharacterTraits,
} from "@vellumai/avatar-manifest";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import { log } from "../log";

const SAMPLE_SIZE = 48;

const DEFAULT_AVATAR_FILE = join(import.meta.dir, "../../assets/hellum-avatar.svg");
const DEFAULT_AVATAR_STATE: AvatarState = {
  kind: "image",
  traits: null,
  source: "upload",
  image: { updatedAt: "1970-01-01T00:00:00.000Z", etag: "hellum-default" },
  accent: { hex: "#000000", source: "palette" },
};

export class AvatarRejectedError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "AvatarRejectedError";
  }
}

export type AvatarImage = { readonly bytes: Uint8Array; readonly contentType: string };

const IMAGE_SIGNATURES: readonly { readonly bytes: readonly number[]; readonly offset: number; readonly contentType: string }[] = [
  { bytes: [0x89, 0x50, 0x4e, 0x47], offset: 0, contentType: "image/png" },
  { bytes: [0xff, 0xd8, 0xff], offset: 0, contentType: "image/jpeg" },
  { bytes: [0x47, 0x49, 0x46, 0x38], offset: 0, contentType: "image/gif" },
  { bytes: [0x57, 0x45, 0x42, 0x50], offset: 8, contentType: "image/webp" },
];

export function detectImageType(bytes: Uint8Array): string | null {
  const match = IMAGE_SIGNATURES.find(({ bytes: signature, offset }) => signature.every((byte, index) => bytes[offset + index] === byte));
  return match?.contentType ?? null;
}

function paletteAccent(colorId: string): AvatarAccent | null {
  const hex = accentHexForColorId(colorId);
  return hex ? { hex, source: "palette" } : null;
}

async function derivedAccent(bytes: Uint8Array): Promise<AvatarAccent | null> {
  try {
    const { data } = await sharp(bytes, { failOn: "error" })
      .resize(SAMPLE_SIZE, SAMPLE_SIZE, { fit: "cover" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const hex = dominantAccentHex(data);
    return hex ? { hex, source: "derived" } : null;
  } catch (error) {
    log.warn("could not read an accent colour out of the avatar image", { error: error instanceof Error ? error.message : String(error) });
    return null;
  }
}

function validateTraits(traits: CharacterTraits): void {
  const components = getCharacterComponents();
  const known: readonly [string, string, readonly { readonly id: string }[]][] = [
    ["body shape", traits.bodyShape, components.bodyShapes],
    ["eye style", traits.eyeStyle, components.eyeStyles],
    ["color", traits.color, components.colors],
  ];
  for (const [label, value, options] of known) {
    if (!options.some((option) => option.id === value)) {
      throw new AvatarRejectedError(`Unknown ${label}: "${value}". Valid IDs: ${options.map((option) => option.id).join(", ")}`);
    }
  }
}

export class AvatarStore {
  private readonly directory: string;

  constructor(
    stateDir: string,
    private readonly onChanged: (imagePath: string) => void,
  ) {
    this.directory = join(stateDir, "avatar");
  }

  async state(): Promise<AvatarState> {
    return (await this.manifest()) ?? DEFAULT_AVATAR_STATE;
  }

  async image(): Promise<AvatarImage | null> {
    const stored = await readFile(this.imagePath()).catch(() => null);
    if (stored) {
      return { bytes: stored, contentType: detectImageType(stored) ?? "application/octet-stream" };
    }
    return (await this.manifest()) ? null : { bytes: await readFile(DEFAULT_AVATAR_FILE), contentType: "image/svg+xml" };
  }

  async setCharacter(traits: CharacterTraits): Promise<void> {
    validateTraits(traits);
    await mkdir(this.directory, { recursive: true });
    await this.writeAtomically(join(this.directory, AVATAR_TRAITS_FILENAME), JSON.stringify(traits, null, 2));
    await rm(this.imagePath(), { force: true });
    await this.commit({ kind: "character", traits, source: "builder", image: null, accent: paletteAccent(traits.color) });
  }

  async setImage(bytes: Uint8Array): Promise<void> {
    const accent = await derivedAccent(bytes);
    await mkdir(this.directory, { recursive: true });
    await this.writeAtomically(this.imagePath(), bytes);
    await rm(join(this.directory, AVATAR_TRAITS_FILENAME), { force: true });
    const { mtimeMs, size } = await stat(this.imagePath());
    const etag = createHash("sha256").update(`${size}:${mtimeMs}`).digest("hex").slice(0, 16);
    await this.commit({ kind: "image", traits: null, source: "upload", image: { updatedAt: new Date(mtimeMs).toISOString(), etag }, accent });
  }

  async setAccent(hex: string | null): Promise<AvatarState | null> {
    const state = await this.manifest();
    if (!state) {
      return null;
    }
    const next: AvatarState = { ...state, accent: hex ? { hex, source: "custom" } : await this.automaticAccent(state) };
    await this.commit(next);
    return next;
  }

  async clear(): Promise<boolean> {
    const hadAvatar = (await this.manifest()) !== null;
    await rm(this.directory, { recursive: true, force: true });
    this.onChanged(this.imagePath());
    return hadAvatar;
  }

  private async automaticAccent(state: AvatarState): Promise<AvatarAccent | null> {
    if (state.kind === "character" && state.traits) {
      return paletteAccent(state.traits.color);
    }
    const image = await readFile(this.imagePath()).catch(() => null);
    return image ? derivedAccent(image) : null;
  }

  private imagePath(): string {
    return join(this.directory, AVATAR_IMAGE_FILENAME);
  }

  private async manifest(): Promise<AvatarState | null> {
    const raw = await readFile(join(this.directory, AVATAR_MANIFEST_FILENAME), "utf8").catch(() => null);
    if (raw === null) {
      return null;
    }
    try {
      return parseAvatarManifest(JSON.parse(raw) as unknown);
    } catch {
      log.warn("avatar manifest is unreadable, treating it as absent");
      return null;
    }
  }

  private async commit(state: AvatarState): Promise<void> {
    await this.writeAtomically(join(this.directory, AVATAR_MANIFEST_FILENAME), JSON.stringify(state, null, 2));
    this.onChanged(this.imagePath());
  }

  private async writeAtomically(path: string, content: string | Uint8Array): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, content, { mode: 0o600 });
    await rename(temporary, path);
  }
}
