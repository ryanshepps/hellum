import { createHash } from "node:crypto";

export type MemoryTarget = "memory" | "user";

export type MemorySnapshot = {
  readonly memory: readonly string[];
  readonly user: readonly string[];
  readonly modifiedAtMs: Readonly<Record<MemoryTarget, number | null>>;
};

export type GraphNode = {
  readonly id: string;
  readonly label: string;
  readonly summary: string;
  readonly kind: string;
  readonly weight: number;
  readonly updatedAtMs?: number;
};

export type GraphEdge = {
  readonly source: string;
  readonly target: string;
  readonly kind: string;
  readonly weight: number;
  readonly directed: boolean;
};

export type MemoryGraph = {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
};

export type MemoryEntryRef = {
  readonly target: MemoryTarget;
  readonly entry: string;
};

const LABEL_LENGTH = 48;

const HUBS: Readonly<Record<MemoryTarget, { readonly id: string; readonly label: string; readonly summary: string }>> = {
  user: { id: "hub:user", label: "You", summary: "What Hermes knows about you" },
  memory: { id: "hub:memory", label: "Hermes' notes", summary: "Notes Hermes keeps for itself" },
};

export function memoryEntryId(target: MemoryTarget, entry: string): string {
  return `${target}:${createHash("sha256").update(entry).digest("hex").slice(0, 16)}`;
}

function labelFor(entry: string): string {
  const firstLine = entry.trim().split("\n")[0]?.trim() ?? "";
  return firstLine.length > LABEL_LENGTH ? `${firstLine.slice(0, LABEL_LENGTH - 1)}…` : firstLine;
}

function entriesOf(snapshot: MemorySnapshot, target: MemoryTarget): readonly string[] {
  return target === "user" ? snapshot.user : snapshot.memory;
}

export function memoryGraph(snapshot: MemorySnapshot): MemoryGraph {
  const targets: readonly MemoryTarget[] = ["user", "memory"];
  const populated = targets.filter((target) => entriesOf(snapshot, target).length > 0);
  const nodes = populated.flatMap((target): GraphNode[] => {
    const updatedAt = snapshot.modifiedAtMs[target];
    const timing = updatedAt === null ? {} : { updatedAtMs: updatedAt };
    const entries = entriesOf(snapshot, target);
    return [
      { id: HUBS[target].id, label: HUBS[target].label, summary: HUBS[target].summary, kind: "capability", weight: entries.length, ...timing },
      ...entries.map((entry) => ({ id: memoryEntryId(target, entry), label: labelFor(entry), summary: entry, kind: "concept", weight: 1, ...timing })),
    ];
  });
  const edges = populated.flatMap((target) =>
    entriesOf(snapshot, target).map((entry) => ({
      source: HUBS[target].id,
      target: memoryEntryId(target, entry),
      kind: "link",
      weight: 1,
      directed: true,
    })),
  );
  return { nodes, edges };
}

export function findMemoryEntry(snapshot: MemorySnapshot, id: string): MemoryEntryRef | null {
  const targets: readonly MemoryTarget[] = ["user", "memory"];
  for (const target of targets) {
    const entry = entriesOf(snapshot, target).find((candidate) => memoryEntryId(target, candidate) === id);
    if (entry !== undefined) {
      return { target, entry };
    }
  }
  return null;
}

export function memoryNodeDetail(snapshot: MemorySnapshot, id: string): { found: false } | { found: true; title: string; content: string } {
  const hub = (Object.keys(HUBS) as MemoryTarget[]).find((target) => HUBS[target].id === id);
  if (hub) {
    return { found: true, title: HUBS[hub].label, content: entriesOf(snapshot, hub).map((entry) => `- ${entry}`).join("\n") };
  }
  const ref = findMemoryEntry(snapshot, id);
  return ref ? { found: true, title: labelFor(ref.entry), content: ref.entry } : { found: false };
}
