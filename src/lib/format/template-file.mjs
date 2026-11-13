// COPY of agentivity_marketplace_content/scripts/lib/template-file.mjs: the rules the founder's publishing script applies, applied here to
// what a person publishes from their workspace. Change both together (test/format-copy.test.mjs in the content repo checks it).
// What the scripts know about a Template file (see agentivity_service/.. /templates/template-format.md): reading its entities,
// following their references, and deriving what the marketplace stores next to the file. Zero dependencies.
import { createHash } from 'node:crypto';

export const ROOT_KINDS = ['agent', 'team', 'workflow'];
export const ENTITY_KINDS = ['agent', 'team', 'workflow', 'datatable', 'knowledgebase'];

/** The assets a step points to by their id, and the input that holds it: a table, a Knowledge Base. */
const ASSET_INPUTS = [['table_id', 'datatable'], ['knowledge_base_id', 'knowledgebase']];
export const LANGUAGES = ['en', 'zh', 'hi', 'es', 'fr', 'ar', 'pt', 'ru', 'de', 'ja'];

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** The entity of an item: `entry` (an object) or, in the older wrapper, `entryJson` (an object or a JSON text). */
export function entryOf(item) {
  if (isObject(item?.entry)) return item.entry;
  const wrapped = item?.entryJson;
  if (isObject(wrapped)) return wrapped;
  if (typeof wrapped === 'string') {
    try {
      const parsed = JSON.parse(wrapped);
      return isObject(parsed) ? parsed : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

/** A value computed at run time ("{{ ... }}", "$x", "=x") cannot be checked against the file. */
export const isComputed = (value) => value.includes('{{') || value.startsWith('$') || value.startsWith('=');

/** The nodes of an agent (its graph) or of a workflow. A team has none. */
function nodesOf(kind, entry) {
  const nodes = kind === 'agent' ? entry?.graph?.nodes : kind === 'workflow' ? entry?.nodes : undefined;
  return Array.isArray(nodes) ? nodes.filter(isObject) : [];
}

/**
 * Every place of an entity that points to another entity of the file.
 * @returns {{ value: string, kinds: string[], asset?: string, where: string }[]}
 */
export function referencesOf(kind, entry) {
  const found = [];
  if (kind === 'team') {
    for (const member of Array.isArray(entry?.members) ? entry.members.filter(isObject) : []) {
      const value = text(member.memberEntityId);
      if (!value) continue;
      const type = String(member.memberType ?? 'agent').toLowerCase();
      found.push({ value, kinds: [type === 'team' ? 'team' : type === 'workflow' ? 'workflow' : 'agent'], where: 'a team member' });
    }
    return found;
  }

  for (const node of nodesOf(kind, entry)) {
    const inputs = isObject(node.inputs) ? node.inputs : {};
    const input = (key) => text(inputs[key]);
    const nodeType = String(node.nodeType ?? '').toLowerCase();
    if (nodeType === 'agentic_node' && input('agent_id')) found.push({ value: input('agent_id'), kinds: ['agent', 'team'], where: `node ${node.id} (agent_id)` });
    if (nodeType === 'team_node' && input('entity_id')) found.push({ value: input('entity_id'), kinds: ['team'], where: `node ${node.id} (entity_id)` });
    if (nodeType === 'composable_node' && input('entity_id')) {
      const wanted = (input('entity_kind') ?? '').toLowerCase();
      found.push({ value: input('entity_id'), kinds: ROOT_KINDS.includes(wanted) ? [wanted] : ROOT_KINDS, where: `node ${node.id} (entity_id)` });
    }
    if (nodeType === 'workflow.run' && input('workflow')) found.push({ value: input('workflow'), kinds: ['workflow'], where: `node ${node.id} (workflow)` });
    for (const [key, asset] of ASSET_INPUTS) if (input(key)) found.push({ value: input(key), kinds: [], asset, where: `node ${node.id} (${key})` });
  }
  return found;
}

/**
 * The entity a reference designates, or undefined. A workflow can be called by its id or by its name (the platform allows both);
 * everything else by id.
 */
export function resolveReference(reference, entities) {
  const wanted = reference.value;
  if (reference.asset) return entities.find((e) => e.kind === reference.asset && e.id === wanted);
  const byId = entities.find((e) => e.id === wanted && reference.kinds.includes(e.kind));
  if (byId) return byId;
  if (reference.kinds.includes('workflow')) return entities.find((e) => e.kind === 'workflow' && String(e.name ?? '').toLowerCase() === wanted.toLowerCase());
  return undefined;
}

/** The Solutions of a file: `roots` when it holds several that work together on the same data, else its `root`. */
export function rootsOf(file) {
  return Array.isArray(file.roots) && file.roots.length > 0 ? file.roots.filter(isObject) : file.root ? [file.root] : [];
}

/** What the roots reach, level after level: `[{ item, depth }]`, the roots first, each item once. */
export function walk(file) {
  const entities = Array.isArray(file.entities) ? file.entities.filter(isObject) : [];
  const roots = rootsOf(file).map((r) => entities.find((e) => e.id === r.id)).filter(Boolean);
  if (roots.length === 0) return [];
  const seen = new Set(roots.map((r) => r.id));
  const out = roots.map((item) => ({ item, depth: 0 }));
  for (let i = 0; i < out.length; i += 1) {
    const { item, depth } = out[i];
    const entry = entryOf(item);
    if (!entry) continue;
    for (const reference of referencesOf(item.kind, entry)) {
      const target = resolveReference(reference, entities);
      if (target && !seen.has(target.id)) {
        seen.add(target.id);
        out.push({ item: target, depth: depth + 1 });
      }
    }
  }
  return out;
}

const stringList = (value) => (Array.isArray(value) ? value.filter((v) => typeof v === 'string') : []);

/** Entities as the render input describes them: id -> { kind, name, role, tags }. */
function membersOf(file) {
  const members = {};
  for (const item of file.entities ?? []) {
    if (!isObject(item) || item.id === file.root?.id || !ROOT_KINDS.includes(item.kind)) continue;
    const entry = entryOf(item) ?? {};
    members[item.id] = { kind: item.kind, name: item.name ?? text(entry.name) ?? item.id, role: text(entry.role), tags: stringList(entry.tags) };
  }
  return members;
}

/** The stable form of a value (sorted keys), so the same Template always gives the same hash. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (isObject(value)) return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableJson(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
}

/** The picture of a `data:` URI: its type, its file extension and its bytes. */
export function readDataUri(dataUri) {
  const match = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataUri ?? '');
  if (!match) return undefined;
  const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' }[match[1]];
  return { mime: match[1], extension, bytes: Buffer.from(match[2], 'base64') };
}

/** The id of an author: a slug (the file's author.id, or the name written as a slug). */
export function authorSlug(author) {
  const source = text(author?.id) ?? text(author?.name) ?? '';
  return source.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

/** The row of public.authors a Template points to: only what the file says (the name and the website). */
export function authorOf(file) {
  return { id: authorSlug(file.author), name: text(file.author?.name) ?? '', ...(text(file.author?.url) ? { url: text(file.author.url) } : {}) };
}

/**
 * What the marketplace row holds, from a validated file. `coverUrl` is where the picture will be served from (the script uploads it
 * first); the stored `content` has no `dataUri`, only that URL.
 */
export function deriveRow(file, { coverUrl, sizeBytes } = {}) {
  const entities = file.entities.filter(isObject);
  const rootItem = entities.find((e) => e.id === file.root.id);
  const rootEntry = entryOf(rootItem) ?? {};
  const kindCount = (kind) => entities.filter((e) => e.kind === kind).length;

  const reached = walk(file);
  const reachedIds = new Set(reached.map((r) => r.item.id));
  const contents = [
    ...reached,
    ...entities.filter((e) => !reachedIds.has(e.id)).map((item) => ({ item, depth: 1 })),
  ].map(({ item, depth }) => {
    const entry = entryOf(item) ?? {};
    return { kind: item.kind, id: item.id, name: item.name ?? text(entry.name) ?? item.id, role: text(entry.role) ?? null, depth };
  });

  const { cover, ...rest } = file;
  const content = { ...rest, ...(coverUrl ? { cover: { imageUrl: coverUrl, ...(cover?.alt ? { alt: cover.alt } : {}) } } : {}) };
  const coverHash = cover?.dataUri ? createHash('sha256').update(cover.dataUri).digest('hex') : '';
  const contentHash = createHash('sha256').update(stableJson(rest)).update(coverHash).digest('hex');

  return {
    slug: file.id,
    version: file.version,
    name: file.name,
    tagline: file.tagline ?? null,
    description: file.description,
    tags: file.tags ?? [],
    language: file.language,
    author_id: authorOf(file).id,
    license: file.license ?? null,
    cover_url: coverUrl ?? null,
    cover_alt: cover?.alt ?? null,
    root_kind: file.root.kind,
    root_id: file.root.id,
    root_name: rootItem.name ?? text(rootEntry.name) ?? file.root.id,
    counts: { agents: kindCount('agent'), teams: kindCount('team'), workflows: kindCount('workflow'), dataTables: kindCount('datatable'), knowledgeBases: kindCount('knowledgebase'), solutions: Math.max(1, rootsOf(file).length) },
    requires: { credentials: stringList(file.requires?.credentials), plugins: stringList(file.requires?.plugins) },
    contents,
    size_bytes: sizeBytes ?? Buffer.byteLength(JSON.stringify(file)),
    content_hash: contentHash,
    content,
    root_view: { kind: file.root.kind, name: rootItem.name ?? text(rootEntry.name) ?? file.root.id, entryJson: JSON.stringify(rootEntry), members: membersOf(file) },
    template_created_at: file.createdAt ?? null,
  };
}
