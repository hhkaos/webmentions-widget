/**
 * Framework-agnostic webmention.io helpers.
 *
 * Nothing in here touches the DOM unless you hand it a document/parser, so the
 * whole module is safe to import during SSR or from a plain Node test run.
 */

export const DEFAULT_API_URL = 'https://webmention.io/api/mentions.jf2';
export const DEFAULT_JSON_API_URL = 'https://webmention.io/api/mentions.json';
export const DEFAULT_MAX_CONTENT_LENGTH = 220;
export const DEFAULT_PER_PAGE = 20;

const CONTEXT_TAGS = ['P', 'LI', 'BLOCKQUOTE'];
const FALLBACK_LOCALE_PREFIXES = ['/es'];

/** Properties rendered as a facepile rather than as a full thread entry. */
export const FACEPILE_PROPERTIES = ['like-of', 'repost-of', 'bookmark-of'];

/**
 * webmention.io is inconsistent about the mention property: the jf2 feed uses
 * `mention-of`, some older payloads and the .json endpoint say `mention`.
 * Normalise so consumers only ever branch on one spelling.
 */
export function normalizeProperty(property) {
  return property === 'mention' ? 'mention-of' : property;
}

const DEFAULT_LABELS = {
  'like-of': 'Like',
  'repost-of': 'Repost',
  'bookmark-of': 'Bookmark',
  'in-reply-to': 'Reply',
  'mention-of': 'Mention',
};

export function getMentionType(mention, labels = {}) {
  const property = normalizeProperty(mention?.['wm-property']);

  return labels[property]
    || DEFAULT_LABELS[property]
    || labels['mention-of']
    || DEFAULT_LABELS['mention-of'];
}

export function cleanText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * webmention.io and Bridgy mangle emoji into runs of "?" (and sometimes U+FFFD)
 * when extracting plain text from a toot or skeet. The emoji is unrecoverable,
 * so drop the debris instead of rendering it.
 */
export function stripMojibake(value) {
  return String(value ?? '')
    .replace(/�+/g, '')
    .replace(/\s*\?{3,}\s*/g, ' ')
    .replace(/\s+([.,!?;:…])/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function getPathnameVariants(pathname, i18n, explicitPrefixes) {
  const normalizedPathname = pathname.startsWith('/') ? pathname : `/${pathname}`;
  const configuredLocalePrefixes = (i18n?.locales || [])
    .filter((locale) => locale !== i18n?.defaultLocale)
    .map((locale) => `/${locale}`);
  const localePrefixes = explicitPrefixes
    || (configuredLocalePrefixes.length > 0 ? configuredLocalePrefixes : FALLBACK_LOCALE_PREFIXES);
  const pathnames = new Set([normalizedPathname]);

  localePrefixes.forEach((prefix) => {
    if (normalizedPathname === prefix) {
      pathnames.add('/');
      return;
    }

    if (normalizedPathname.startsWith(`${prefix}/`)) {
      pathnames.add(normalizedPathname.slice(prefix.length) || '/');
      return;
    }

    pathnames.add(normalizedPathname === '/' ? prefix : `${prefix}${normalizedPathname}`);
  });

  return [...pathnames];
}

/**
 * webmention.io matches targets by exact string, so a mention stored against
 * `https://example.com/post/` is invisible to a query for
 * `https://www.example.com/post`. Expand every variant we might have published
 * under: www/no-www, trailing slash or not, and locale-prefixed paths.
 */
export function getCanonicalTargets({siteUrl, pathname = '/', i18n, localePrefixes} = {}) {
  if (!siteUrl) {
    return [];
  }

  const baseUrl = new URL(siteUrl);
  const hosts = baseUrl.hostname.startsWith('www.')
    ? [baseUrl.hostname, baseUrl.hostname.replace(/^www\./, '')]
    : [baseUrl.hostname, `www.${baseUrl.hostname}`];

  return [...new Set(getPathnameVariants(pathname, i18n, localePrefixes).flatMap((pathnameVariant) => (
    hosts.flatMap((hostname) => {
      const targetUrl = new URL(pathnameVariant, siteUrl);
      targetUrl.hostname = hostname;
      targetUrl.hash = '';
      targetUrl.search = '';

      const canonicalUrl = targetUrl.toString();
      const withoutSlash = canonicalUrl.replace(/\/$/, '');
      const withSlash = canonicalUrl.endsWith('/') ? canonicalUrl : `${canonicalUrl}/`;

      return [canonicalUrl, withoutSlash, withSlash].filter(Boolean);
    })
  )))];
}

export function getCanonicalTargetsFromDocument(doc = globalThis.document) {
  const canonical = doc?.querySelector?.('link[rel="canonical"]')?.href || doc?.location?.href;

  if (!canonical) {
    return [];
  }

  const url = new URL(canonical);

  return getCanonicalTargets({siteUrl: url.origin, pathname: url.pathname});
}

export function formatMentionDate(value, locale) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date);
}

const RELATIVE_UNITS = [
  ['second', 1000],
  ['minute', 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
];

/** Default: fall back to an absolute date once a snapshot is over a day old. */
export const DEFAULT_RELATIVE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

/**
 * "3 hours ago" for a recent timestamp, `null` once it is old enough that an
 * absolute date reads better. `null` is the signal to the caller to format the
 * date instead — "27 days ago" is worse than "5 Sept".
 */
export function formatRelativeTime(value, locale, {
  now = Date.now(),
  thresholdMs = DEFAULT_RELATIVE_THRESHOLD_MS,
} = {}) {
  if (!value || typeof Intl?.RelativeTimeFormat !== 'function') {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const elapsed = now - date.getTime();

  // A clock skew that puts the snapshot slightly in the future should read as
  // "now", not as a negative age.
  if (elapsed > thresholdMs) {
    return null;
  }

  const formatter = new Intl.RelativeTimeFormat(locale, {numeric: 'auto'});
  const [unit, unitMs] = [...RELATIVE_UNITS]
    .reverse()
    .find(([, ms]) => Math.abs(elapsed) >= ms) || RELATIVE_UNITS[0];
  const amount = Math.round(elapsed / unitMs);

  return formatter.format(-amount, unit);
}

/** The exact moment, for a tooltip or an expanded view. */
export function formatDateTime(value, locale) {
  if (!value) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(date);
}

/**
 * What to show for a snapshot timestamp: a relative phrase while it is fresh,
 * an absolute date once it is not, plus the exact moment for the tooltip.
 */
export function describeTimestamp(value, locale, options = {}) {
  const relative = formatRelativeTime(value, locale, options);

  return {
    label: relative || formatMentionDate(value, locale),
    exact: formatDateTime(value, locale),
    isRelative: Boolean(relative),
  };
}

function normalizeUrl(value, base) {
  if (!value) {
    return null;
  }

  try {
    const url = new URL(value, base);
    url.hash = '';

    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}

function normalizeMentionText(value, mention = {}) {
  const text = stripMojibake(cleanText(value)).replace(/^\?{2,}\s*/, '');
  const name = stripMojibake(cleanText(mention.name)).replace(/^\?{2,}\s*/, '');

  // Mastodon-sourced entries repeat the post name at the head of the content.
  if (name && text.indexOf(name) === 0) {
    return cleanText(text.slice(name.length));
  }

  return text
    .replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
}

function moveStartToWordBoundary(content, start, focusIndex) {
  if (start === 0) {
    return start;
  }

  const nextSpace = content.slice(start).search(/\s/);
  const nextStart = nextSpace === -1 ? start : start + nextSpace + 1;

  return nextStart < focusIndex ? nextStart : start;
}

function moveEndToWordBoundary(content, end, focusEnd) {
  if (end === content.length) {
    return end;
  }

  const previousSpace = content.slice(0, end).lastIndexOf(' ');

  return previousSpace > focusEnd ? previousSpace : end;
}

export function excerptText(value, {
  focus,
  focusIndex,
  mention,
  maxLength = DEFAULT_MAX_CONTENT_LENGTH,
} = {}) {
  const content = normalizeMentionText(value, mention);

  if (!content) {
    return null;
  }

  if (content.length <= maxLength) {
    return content;
  }

  const focusedText = cleanText(focus);
  const resolvedFocusIndex = Number.isInteger(focusIndex)
    ? focusIndex
    : focusedText ? content.indexOf(focusedText) : -1;

  if (resolvedFocusIndex === -1) {
    const end = moveEndToWordBoundary(content, maxLength - 3, 0);

    return `${content.slice(0, end)}...`;
  }

  const maxContextLength = maxLength - 6;
  const roomAroundFocus = Math.max(maxContextLength - focusedText.length, 0);
  const focusEnd = resolvedFocusIndex + focusedText.length;
  const start = Math.max(0, resolvedFocusIndex - Math.floor(roomAroundFocus / 2));
  const end = Math.min(content.length, start + maxContextLength);
  const adjustedStart = Math.max(0, end - maxContextLength);
  const wordStart = moveStartToWordBoundary(content, adjustedStart, resolvedFocusIndex);
  const wordEnd = moveEndToWordBoundary(content, end, focusEnd);
  const excerpt = content.slice(wordStart, wordEnd);

  return `${wordStart > 0 ? '...' : ''}${excerpt}${wordEnd < content.length ? '...' : ''}`;
}

function defaultParseHTML(html) {
  if (typeof DOMParser === 'undefined') {
    return null;
  }

  return new DOMParser().parseFromString(html, 'text/html');
}

function getLinkContext(context, link) {
  if (context === link) {
    return {text: cleanText(link.textContent), focusIndex: 0};
  }

  const marker = '__webmention_link_context__';

  link.insertAdjacentText('beforebegin', marker);
  link.insertAdjacentText('afterend', marker);

  const markedText = cleanText(context.textContent);
  const focusIndex = markedText.indexOf(marker);
  const text = cleanText(markedText.replaceAll(marker, ''));

  return {text, focusIndex};
}

/**
 * Find the anchor in the source page that points back at us and quote the
 * sentence around it, rather than blindly excerpting from the top of the post.
 */
function findLinkContext(html, target, source, maxLength, parseHTML) {
  const normalizedTarget = normalizeUrl(target);
  if (!html || !normalizedTarget) {
    return null;
  }

  const doc = parseHTML(html);
  if (!doc) {
    return null;
  }

  const link = [...doc.querySelectorAll('a[href]')].find((anchor) => (
    normalizeUrl(anchor.getAttribute('href'), source) === normalizedTarget
      || normalizeUrl(anchor.href) === normalizedTarget
  ));

  if (!link) {
    return null;
  }

  const context = CONTEXT_TAGS.includes(link.parentElement?.tagName)
    ? link.parentElement
    : link.closest(CONTEXT_TAGS.map((tagName) => tagName.toLowerCase()).join(','));
  const {text, focusIndex} = getLinkContext(context || link, link);

  return excerptText(text, {focus: link.textContent, focusIndex, maxLength});
}

export function getMentionContent(mention, options = {}) {
  const parseHTML = options.parseHTML || defaultParseHTML;

  return findLinkContext(
    mention.content?.html,
    mention['wm-target'],
    mention['wm-source'],
    options.maxLength,
    parseHTML,
  )
    || excerptText(mention.content?.text, {...options, mention})
    || excerptText(mention.content?.html, {...options, mention});
}

/** Deep-link back into the source post at the quoted sentence. */
export function getMentionSourceUrl(mention, content) {
  const sourceUrl = mention.url || mention['wm-source'];
  const fragmentText = cleanText(content).replace(/^\.\.\./, '').replace(/\.\.\.$/, '');

  if (!sourceUrl || !fragmentText) {
    return sourceUrl;
  }

  try {
    const url = new URL(sourceUrl);
    url.hash = `:~:text=${encodeURIComponent(fragmentText)}`;

    return url.toString();
  } catch {
    return sourceUrl;
  }
}

function getAuthorKey(mention) {
  const author = mention.author || {};

  return cleanText(author.url || author.name || author.photo || mention.url || mention['wm-source']);
}

/**
 * Split a feed into a facepile and a thread.
 *
 * `interactions` is the flat, deduped facepile kept for backwards
 * compatibility; `byProperty` keeps like/repost/bookmark separate so a renderer
 * can show "3 likes · 1 repost" instead of one undifferentiated pile.
 */
export function groupWebmentions(mentions, {facepileProperties = FACEPILE_PROPERTIES} = {}) {
  const facepileSet = new Set(facepileProperties);
  const seenMentions = new Set();
  const interactionAuthors = new Set();
  const byProperty = Object.fromEntries(facepileProperties.map((property) => [property, []]));
  const interactions = [];
  const threads = [];

  (mentions || []).forEach((mention) => {
    if (!mention || !(mention.url || mention['wm-source'])) {
      return;
    }

    const property = normalizeProperty(mention['wm-property']);
    const mentionKey = mention['wm-id'] ?? `${mention['wm-source']}|${property}`;

    if (seenMentions.has(mentionKey)) {
      return;
    }
    seenMentions.add(mentionKey);

    if (facepileSet.has(property)) {
      const authorKey = `${property}|${getAuthorKey(mention)}`;

      if (!interactionAuthors.has(authorKey)) {
        interactionAuthors.add(authorKey);
        byProperty[property].push(mention);
        interactions.push(mention);
      }

      return;
    }

    threads.push(mention);
  });

  const counts = Object.fromEntries(
    Object.entries(byProperty).map(([property, items]) => [property, items.length]),
  );

  return {
    interactions,
    threads,
    byProperty,
    counts: {...counts, thread: threads.length},
    total: interactions.length + threads.length,
  };
}

/**
 * Match a mention's stored target against the variants we query for a page.
 * Comparison ignores the trailing slash and the fragment, so a snapshot taken
 * against one variant still matches a page queried under another.
 */
function targetMatches(mention, normalizedTargets) {
  const target = normalizeUrl(mention?.['wm-target']);

  return Boolean(target) && normalizedTargets.has(target);
}

/**
 * Narrow a whole-domain snapshot down to one page.
 *
 * A build-time snapshot is fetched once for the entire site (webmention.io's
 * `domain=` query), so each page has to pick out its own mentions locally
 * rather than asking the API again.
 */
export function filterMentionsByTargets(mentions, targets = []) {
  const normalizedTargets = new Set(
    targets.map((target) => normalizeUrl(target)).filter(Boolean),
  );

  if (!normalizedTargets.size) {
    return [];
  }

  return (mentions || []).filter((mention) => targetMatches(mention, normalizedTargets));
}

/**
 * Read a snapshot in either accepted shape: a bare array of entries, or the
 * `{mentions, generatedAt, lastId}` envelope that the refresh job writes.
 */
export function getSnapshotMentions(snapshot) {
  if (Array.isArray(snapshot)) {
    return snapshot;
  }

  return snapshot?.mentions || snapshot?.children || [];
}

/**
 * Merge a fresh page of mentions into a snapshot, newest first, deduped by
 * `wm-id`. Used by the refresh job so an incremental `since_id` fetch does not
 * have to re-download everything.
 */
export function mergeSnapshot(existing, incoming) {
  const byId = new Map();

  [...getSnapshotMentions(existing), ...(incoming || [])].forEach((mention) => {
    const key = mention?.['wm-id'] ?? mention?.['wm-source'];

    if (key != null) {
      byId.set(key, mention);
    }
  });

  const mentions = [...byId.values()].sort((a, b) => (
    (b['wm-id'] ?? 0) - (a['wm-id'] ?? 0)
  ));

  return {
    generatedAt: new Date().toISOString(),
    lastId: mentions.reduce((max, mention) => Math.max(max, mention['wm-id'] ?? 0), 0) || null,
    count: mentions.length,
    mentions,
  };
}

const VALID_JSON_ESCAPES = new Set(['"', '\\', '/', 'b', 'f', 'n', 'r', 't', 'u']);

/**
 * Repair the malformed JSON webmention.io sometimes serves.
 *
 * Its serializer copies source-page content into string literals without
 * escaping it, so a mention whose content contains a backslash (a shell example
 * ending in `\`, say) or a raw newline produces a payload that `JSON.parse`
 * rejects outright. The mention is then invisible — not because the API was
 * down, but because its response could not be read at all.
 *
 * Walks the text tracking whether it is inside a string literal, escaping only
 * the offending characters and leaving valid escapes untouched.
 */
export function repairJson(text) {
  let out = '';
  let inString = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (!inString) {
      if (char === '"') {
        inString = true;
      }

      out += char;
      continue;
    }

    if (char === '"') {
      inString = false;
      out += char;
      continue;
    }

    if (char === '\\') {
      const next = text[index + 1];

      if (VALID_JSON_ESCAPES.has(next)) {
        out += char + next;
        index += 1;
      } else {
        out += '\\\\';
      }

      continue;
    }

    const code = char.charCodeAt(0);

    if (code < 0x20) {
      if (code === 0x0a) {
        out += '\\n';
      } else if (code === 0x0d) {
        out += '\\r';
      } else if (code === 0x09) {
        out += '\\t';
      } else {
        out += `\\u${code.toString(16).padStart(4, '0')}`;
      }

      continue;
    }

    out += char;
  }

  return out;
}

/** Parse a webmention.io response, repairing it only if it will not parse. */
export function parseWebmentionJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return JSON.parse(repairJson(text));
  }
}

export class WebmentionFetchError extends Error {
  constructor(message, {status, attempts, cause} = {}) {
    super(message, {cause});
    this.name = 'WebmentionFetchError';
    this.status = status;
    this.attempts = attempts;
  }
}

const ACTIVITY_TO_PROPERTY = {
  like: 'like-of',
  repost: 'repost-of',
  bookmark: 'bookmark-of',
  reply: 'in-reply-to',
  link: 'mention-of',
  mention: 'mention-of',
};

/**
 * Reshape a `/api/mentions.json` payload into the jf2 entry shape so the
 * fallback path is invisible to callers.
 */
export function normalizeJsonFeed(payload) {
  return (payload?.links || []).map((link) => {
    const data = link.data || {};

    return {
      type: 'entry',
      author: data.author || {},
      url: data.url || link.source,
      name: data.name || null,
      content: data.content ? {text: data.content} : undefined,
      published: data.published || null,
      'wm-received': link.verified_date || null,
      'wm-id': link.id,
      'wm-source': link.source,
      'wm-target': link.target,
      'wm-property': ACTIVITY_TO_PROPERTY[link.activity?.type] || 'mention-of',
      'wm-private': Boolean(link.private),
    };
  });
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (ms <= 0) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);

    function onAbort() {
      clearTimeout(timer);
      const error = new Error('Aborted');
      error.name = 'AbortError';
      reject(error);
    }

    signal?.addEventListener?.('abort', onAbort, {once: true});
  });
}

function buildQuery({targets, perPage, sortBy, sortDir}) {
  const params = new URLSearchParams({
    'per-page': String(perPage),
    'sort-by': sortBy,
    'sort-dir': sortDir,
  });

  targets.forEach((target) => params.append('target[]', target));

  return params.toString();
}

/**
 * Fetch mentions for one or more targets.
 *
 * webmention.io returns intermittent 502s whose nginx error page carries no
 * CORS header, so in a browser a transient upstream blip surfaces as an opaque
 * "Failed to fetch". A single un-retried request therefore blanks the widget
 * for reasons that have nothing to do with the page. Hence: retries with
 * backoff, then a fallback to the older .json endpoint, then a typed throw so
 * the caller can tell "no mentions" from "could not load".
 */
export async function fetchWebmentions({
  targets,
  apiUrl = DEFAULT_API_URL,
  jsonApiUrl = DEFAULT_JSON_API_URL,
  perPage = DEFAULT_PER_PAGE,
  sortBy = 'published',
  sortDir = 'down',
  signal,
  retries = 2,
  retryDelayMs = 400,
  fallbackToJson = true,
  fetch: fetchImpl = globalThis.fetch,
  document: doc,
} = {}) {
  const resolvedTargets = targets?.length ? targets : getCanonicalTargetsFromDocument(doc);

  if (!resolvedTargets.length) {
    return [];
  }

  if (typeof fetchImpl !== 'function') {
    throw new WebmentionFetchError('No fetch implementation available');
  }

  const query = buildQuery({targets: resolvedTargets, perPage, sortBy, sortDir});
  const endpoints = fallbackToJson
    ? [{url: apiUrl, json: false}, {url: jsonApiUrl, json: true}]
    : [{url: apiUrl, json: false}];

  let attempts = 0;
  let lastError = null;

  for (const endpoint of endpoints) {
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      if (attempts > 0) {
        // Exponential backoff, shared across endpoints so a hard outage does
        // not turn into a request storm.
        await wait(retryDelayMs * 2 ** (attempts - 1), signal);
      }

      attempts += 1;

      try {
        const response = await fetchImpl(`${endpoint.url}?${query}`, {signal});

        if (!response.ok) {
          lastError = new WebmentionFetchError(
            `webmention.io responded with ${response.status}`,
            {status: response.status, attempts},
          );

          // 4xx will not fix itself; stop hammering and let the fallback try.
          if (response.status < 500 && response.status !== 429) {
            break;
          }

          continue;
        }

        const data = parseWebmentionJson(await response.text());

        return endpoint.json
          ? normalizeJsonFeed(data)
          : Array.isArray(data?.children) ? data.children : [];
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        lastError = error;
      }
    }
  }

  throw new WebmentionFetchError(
    `Could not load webmentions after ${attempts} attempt(s): ${lastError?.message || 'unknown error'}`,
    {status: lastError?.status, attempts, cause: lastError},
  );
}
