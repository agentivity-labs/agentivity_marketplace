// COPY of agentivity_marketplace_content/scripts/lib/validate-template.mjs: the rules the founder's publishing script applies, applied here to
// what a person publishes from their workspace. Change both together (test/format-copy.test.mjs in the content repo checks it).
// The rules a Template must follow before it is published (section 7 of template-format.md): the same rules as the platform's export
// and import. A Template that breaks one is refused with a list of what to fix. Zero dependencies.
import { ENTITY_KINDS, LANGUAGES, ROOT_KINDS, authorSlug, entryOf, isComputed, readDataUri, referencesOf, resolveReference } from './template-file.mjs';

export const LIMITS = {
  fileBytes: 5 * 1024 * 1024,
  coverBytes: 200 * 1024,
  rowsPerTable: 1000,
  dataBytes: 2 * 1024 * 1024,
  maxTags: 12,
};

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

// The rules of agentivity_service/tools/build/scan-secrets.mjs: shapes of real keys (a key found here would be public).
const SECRET_DETECTORS = [
  ['Brevo API key', /xkeysib-[a-f0-9]{40,}/g],
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/g],
  ['OpenAI API key', /(?<![A-Za-z0-9])sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/g],
  ['Stripe live key', /\b[sr]k_live_[A-Za-z0-9]{16,}/g],
  ['Stripe webhook secret', /\bwhsec_[A-Za-z0-9]{24,}/g],
  ['AWS access key id', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ['GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})/g],
  ['Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['SendGrid API key', /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g],
  ['Private key', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY/g],
];
// Obvious placeholders are not secrets (xxxx..., 0000..., "example", "your_key"...).
const PLACEHOLDER = /(x{6,}|0{8,}|\.{3}|<[^>]+>|example|your[-_ ]?(?:api[-_ ]?)?key|placeholder|dummy|changeme|redacted)/i;
// A path of the author's machine travels badly.
// (JSON writes one backslash as two, so both forms are accepted.)
const LOCAL_PATH = /(?:\b[A-Za-z]:\\{1,2}(?:Users|Dev|Projects)\\{1,2}|\/(?:home|Users)\/[A-Za-z0-9._-]+\/)/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The secrets found in a text: `[{ kind, preview }]`, never the whole value. */
export function findSecrets(content) {
  const found = [];
  for (const [kind, pattern] of SECRET_DETECTORS) {
    for (const match of content.matchAll(pattern)) {
      if (PLACEHOLDER.test(match[0])) continue;
      found.push({ kind, preview: `${match[0].slice(0, 6)}${'*'.repeat(8)} (${match[0].length} chars)` });
    }
  }
  return found;
}

/**
 * Checks a parsed Template file.
 * @param {unknown} file the parsed JSON
 * @param {{ rawText?: string }} [options] the file as written: used for the size, the secret scan and the machine paths
 * @returns {{ ok: boolean, problems: { code: string, message: string }[], warnings: { code: string, message: string }[] }}
 */
export function validateTemplate(file, { rawText } = {}) {
  const problems = [];
  const warnings = [];
  const problem = (code, message) => problems.push({ code, message });
  const warn = (code, message) => warnings.push({ code, message });

  if (!isObject(file)) return { ok: false, problems: [{ code: 'not_an_object', message: 'The file is not a JSON object.' }], warnings };

  // 1. Schema, id, version
  if (file.schema !== 'agentivity.template') problem('invalid_schema', 'schema must be "agentivity.template".');
  if (file.schemaVersion !== 1) problem('invalid_schema_version', 'schemaVersion must be 1.');
  if (typeof file.id !== 'string' || !SLUG.test(file.id) || file.id.length < 3 || file.id.length > 64) problem('invalid_id', 'id must be a kebab-case slug of 3 to 64 characters.');
  if (typeof file.version !== 'string' || !SEMVER.test(file.version)) problem('invalid_version', 'version must be a semver such as "1.0.0".');

  // 2. Presentation
  const length = (value) => (typeof value === 'string' ? value.trim().length : -1);
  if (length(file.name) < 3 || length(file.name) > 80) problem('invalid_name', 'name is required, 3 to 80 characters.');
  if (file.tagline !== undefined && (typeof file.tagline !== 'string' || file.tagline.length > 120)) problem('tagline_too_long', 'tagline is 120 characters at most.');
  if (length(file.description) < 20 || length(file.description) > 2000) problem('invalid_description', 'description is required, 20 to 2000 characters.');
  if (!LANGUAGES.includes(file.language)) problem('invalid_language', `language is one of: ${LANGUAGES.join(', ')}.`);
  if (!isObject(file.author) || length(file.author.name) < 2 || length(file.author.name) > 80) problem('author_required', 'author.name is required, 2 to 80 characters.');
  else if (authorSlug(file.author).length < 2) problem('invalid_author', 'author.id (or the name) must give a slug of 2 to 64 letters and digits.');
  else if (file.author.url !== undefined && !/^https:\/\//.test(String(file.author.url))) problem('invalid_author_url', 'author.url must start with https://.');

  const tags = file.tags ?? [];
  if (!Array.isArray(tags)) problem('invalid_tags', 'tags must be a list.');
  else {
    if (tags.length > LIMITS.maxTags) problem('too_many_tags', `${LIMITS.maxTags} tags at most.`);
    const seen = new Set();
    for (const tag of tags) {
      if (typeof tag !== 'string' || !SLUG.test(tag) || tag.length < 2 || tag.length > 32) problem('invalid_tag', `The tag "${tag}" must be lower-case letters, digits and dashes (2 to 32 characters).`);
      else if (tag === 'solution') problem('invalid_tag', 'The tag "solution" is the label, not a free tag.');
      else if (seen.has(tag)) problem('invalid_tag', `The tag "${tag}" is listed twice.`);
      seen.add(tag);
    }
  }

  // 3. Entities and root
  const entities = Array.isArray(file.entities) ? file.entities : [];
  if (!Array.isArray(file.entities) || entities.length === 0) problem('no_entities', 'entities must list at least the root.');
  const ids = new Set();
  for (const item of entities) {
    if (!isObject(item) || typeof item.id !== 'string' || !item.id || !ENTITY_KINDS.includes(item.kind)) {
      problem('invalid_entity', 'Every entity needs an id and a kind (agent, team, workflow, datatable or knowledgebase).');
      continue;
    }
    // What belongs to the author's installation (a path on the server, a connection string) is named, never carried.
    if (item.toConfigure !== undefined) {
      if (!Array.isArray(item.toConfigure) || !item.toConfigure.every((s) => typeof s === 'string' && s)) problem('invalid_entity', `The entity "${item.name ?? item.id}": toConfigure must be a list of setting names.`);
      else {
        const settings = isObject(entryOf(item)?.settings) ? entryOf(item).settings : {};
        for (const name of item.toConfigure.filter((s) => settings[s] !== undefined && settings[s] !== null && settings[s] !== '')) {
          problem('installation_setting', `The ${item.kind} "${item.name ?? item.id}" carries its ${name}: it belongs to the author's installation and is filled in by whoever imports it. Leave it out of the file.`);
        }
      }
    }
    if (ids.has(item.id)) problem('duplicate_entity', `The entity id "${item.id}" is used twice.`);
    ids.add(item.id);
    if (!entryOf(item)) problem('unreadable_entity', `The entity "${item.name ?? item.id}" has no readable entry.`);
  }

  const root = isObject(file.root) ? file.root : undefined;
  const rootItem = root ? entities.find((e) => isObject(e) && e.id === root.id) : undefined;
  if (!root || !rootItem) problem('root_not_found', 'root must designate an entity of the file.');
  else {
    if (!ROOT_KINDS.includes(root.kind) || rootItem.kind !== root.kind) problem('invalid_root', 'The root is a team, a workflow or an agent, and its kind must match the entity.');
    const tagsOfRoot = entryOf(rootItem)?.tags;
    if (!Array.isArray(tagsOfRoot) || !tagsOfRoot.some((t) => String(t).toLowerCase() === 'solution')) problem('root_not_solution', 'The root entity must carry the tag "solution".');
    else if (!tagsOfRoot.includes('solution')) warn('root_tag_case', 'The tag of the root is written with capitals ("Solution"): "solution" is the form of the format.');
  }
  // Several Solutions that work together on the same data: each one an entity of the file and a Solution, the first being the root.
  if (file.roots !== undefined) {
    if (!Array.isArray(file.roots) || file.roots.length === 0) problem('invalid_roots', 'roots, when present, lists the Solutions of the file.');
    else {
      if (!isObject(file.roots[0]) || file.roots[0].id !== root?.id) problem('invalid_roots', 'The first of roots is the root.');
      for (const each of file.roots) {
        const item = isObject(each) ? entities.find((e) => isObject(e) && e.id === each.id) : undefined;
        if (!item || !ROOT_KINDS.includes(each.kind) || item.kind !== each.kind) problem('root_not_found', `Each of roots designates a team, a workflow or an agent of the file ("${each?.id ?? '?'}" does not).`);
        else if (!(entryOf(item)?.tags ?? []).some((t) => String(t).toLowerCase() === 'solution')) problem('root_not_solution', `The Solution "${item.name ?? item.id}" must carry the tag "solution".`);
      }
    }
  }
  if (Array.isArray(tags) && tags.includes('showcase')) warn('showcase_tag', 'The tag "showcase" is no longer a concept of the catalog.');

  // 4. The closure: every reference points to an entity of the file
  const usable = entities.filter((e) => isObject(e) && ids.has(e.id));
  for (const item of usable) {
    const entry = entryOf(item);
    if (!entry) continue;
    for (const reference of referencesOf(item.kind, entry)) {
      if (isComputed(reference.value)) continue;
      if (!resolveReference(reference, usable)) {
        problem('reference_not_found', `The ${item.kind} "${item.name ?? item.id}" points to "${reference.value}" (${reference.where}), which is not in the file.`);
      }
    }
  }

  // 5. Size
  if (rawText !== undefined && Buffer.byteLength(rawText) > LIMITS.fileBytes) problem('file_too_large', `The file is above ${LIMITS.fileBytes / 1024 / 1024} MB.`);
  if (file.cover !== undefined && file.cover !== null) {
    if (!isObject(file.cover)) problem('invalid_cover', 'cover must be an object.');
    else if (file.cover.dataUri !== undefined) {
      const picture = readDataUri(file.cover.dataUri);
      if (!picture) problem('invalid_cover', 'cover.dataUri must be a base64 data URI of a png, jpeg, webp or svg picture.');
      else if (picture.bytes.length > LIMITS.coverBytes) problem('cover_too_large', `The cover is ${Math.round(picture.bytes.length / 1024)} KB: the limit is ${LIMITS.coverBytes / 1024} KB.`);
    } else if (file.cover.imageUrl === undefined) problem('invalid_cover', 'cover needs a dataUri.');
  }
  const data = isObject(file.data) ? file.data : {};
  for (const [table, value] of Object.entries(data)) {
    if (Array.isArray(value?.rows) && value.rows.length > LIMITS.rowsPerTable) problem('data_too_large', `The table "${table}" has ${value.rows.length} rows: the limit is ${LIMITS.rowsPerTable}.`);
  }
  if (Buffer.byteLength(JSON.stringify(data)) > LIMITS.dataBytes) problem('data_too_large', `The seed rows are above ${LIMITS.dataBytes / 1024 / 1024} MB.`);

  // 6. No secret, no machine path
  const written = rawText ?? JSON.stringify(file);
  for (const secret of findSecrets(written)) problem('secret_found', `A ${secret.kind} is in the file (${secret.preview}).`);
  // The cover is a base64 picture: leave it out of the path scan.
  const withoutCover = written.replace(/"dataUri"\s*:\s*"[^"]*"/g, '"dataUri":""');
  if (LOCAL_PATH.test(withoutCover)) warn('local_path', 'The file mentions a path of a local machine.');

  return { ok: problems.length === 0, problems, warnings };
}
