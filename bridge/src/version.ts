const SHORT_SHA = ["rev-parse", "--short", "HEAD"];

async function commitOf(directory: string): Promise<string> {
  const child = Bun.spawn(["git", "-C", directory, ...SHORT_SHA], { stdout: "pipe", stderr: "ignore" });
  const [exitCode, output] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  return exitCode === 0 && output.trim() ? output.trim() : "unknown";
}

export async function displayVersion(hermesDirectory: string): Promise<string> {
  const [hellum, hermes] = await Promise.all([commitOf(import.meta.dir), commitOf(hermesDirectory)]);
  return `Hellum ${hellum} · Hermes ${hermes}`;
}
