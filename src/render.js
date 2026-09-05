/**
 * Imperative DOM renderer, for sites without a component framework.
 *
 * Every remote string goes through `textContent`; nothing here ever assigns
 * remote HTML.
 */

import {
  FACEPILE_PROPERTIES,
  fetchWebmentions,
  formatMentionDate,
  getMentionContent,
  getMentionSourceUrl,
  getMentionType,
  groupWebmentions,
  normalizeProperty,
} from './core.js';

export const DEFAULT_CLASS_NAMES = {
  facepile: 'webmentions__facepile',
  facepileGroup: 'webmentions__group',
  facepileFaces: 'webmentions__faces',
  facepileCount: 'webmentions__count',
  facepileGlyph: 'webmentions__glyph',
  facepileItem: 'webmentions__facepile-item',
  facepileLink: 'webmentions__facepile-link',
  facepilePhoto: 'webmentions__facepile-photo',
  threadList: 'webmentions__list',
  threadItem: 'webmentions__item h-cite',
  threadBody: 'webmentions__body',
  threadMeta: 'webmentions__meta',
  threadAuthor: 'webmentions__author p-author h-card u-url',
  threadContent: 'webmentions__content p-content',
  threadSource: 'webmentions__source u-url',
  threadPhoto: '',
  updated: 'webmentions__updated',
};

const FACEPILE_META = {
  'like-of': {className: 'is-like', glyph: '♥'},
  'repost-of': {className: 'is-repost', glyph: '↻'},
  'bookmark-of': {className: 'is-bookmark', glyph: '⚑'},
};

/**
 * A label may be a plain string, or a `{en: '…', es: '…'}` map for sites that
 * ship both languages in the markup and toggle them with CSS.
 */
function appendLabel(parent, label, doc) {
  if (label == null) {
    return;
  }

  if (typeof label === 'string') {
    parent.appendChild(doc.createTextNode(label));
    return;
  }

  Object.entries(label).forEach(([lang, text]) => {
    const span = doc.createElement('span');
    span.className = `i18n-${lang}`;
    span.lang = lang;
    span.textContent = text;
    parent.appendChild(span);
  });
}

function resolveElement(value, root, doc) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return root?.querySelector(value) || doc.querySelector(value);
  }

  return value;
}

function authorOf(mention) {
  const author = mention.author || {};
  const source = mention.url || mention['wm-source'] || '';
  let host = '';

  try {
    host = new URL(source).hostname.replace(/^www\./, '');
  } catch {
    host = '';
  }

  return {
    name: String(author.name || '').trim() || host || 'Someone',
    url: author.url || source,
    photo: author.photo || '',
  };
}

function createAvatar(author, className, doc, size) {
  let element;

  if (author.photo) {
    element = doc.createElement('img');
    element.src = author.photo;
    element.alt = '';
    element.loading = 'lazy';
    element.width = size;
    element.height = size;
  } else {
    element = doc.createElement('span');
    element.setAttribute('aria-hidden', 'true');
    element.textContent = (author.name.charAt(0) || '?').toUpperCase();
  }

  if (className) {
    element.className = className;
  }

  return element;
}

function createFace(mention, classNames, doc) {
  const author = authorOf(mention);
  const item = doc.createElement('li');
  item.className = classNames.facepileItem;

  const link = doc.createElement('a');
  link.className = classNames.facepileLink;
  link.href = mention.url || mention['wm-source'] || author.url || '#';
  link.rel = 'nofollow noopener';
  link.target = '_blank';
  link.title = `${author.name} — ${getMentionType(mention)}`;
  link.appendChild(createAvatar(author, classNames.facepilePhoto, doc, 32));

  item.appendChild(link);

  return item;
}

function createFacepileGroup(property, mentions, {classNames, labels, doc}) {
  const meta = FACEPILE_META[property] || {className: '', glyph: ''};
  const group = doc.createElement('div');
  group.className = `${classNames.facepileGroup} ${meta.className}`.trim();

  const faces = doc.createElement('ol');
  faces.className = classNames.facepileFaces;
  mentions.forEach((mention) => faces.appendChild(createFace(mention, classNames, doc)));
  group.appendChild(faces);

  const count = doc.createElement('span');
  count.className = classNames.facepileCount;

  if (meta.glyph) {
    const glyph = doc.createElement('span');
    glyph.className = classNames.facepileGlyph;
    glyph.setAttribute('aria-hidden', 'true');
    glyph.textContent = meta.glyph;
    count.appendChild(glyph);
  }

  const number = doc.createElement('span');
  number.textContent = String(mentions.length);
  count.appendChild(number);
  group.appendChild(count);

  const accessibleName = `${mentions.length} ${getMentionType({'wm-property': property}, labels)}`;
  group.setAttribute('aria-label', accessibleName);
  group.title = accessibleName;

  return group;
}

function createThreadItem(mention, {classNames, labels, locale, maxLength, doc}) {
  const author = authorOf(mention);
  const published = mention.published || mention['wm-received'];
  const formattedDate = formatMentionDate(published, locale);
  const content = getMentionContent(mention, {maxLength});
  const sourceUrl = getMentionSourceUrl(mention, content);

  const item = doc.createElement('li');
  item.className = classNames.threadItem;

  if (classNames.threadPhoto) {
    item.appendChild(createAvatar(author, classNames.threadPhoto, doc, 40));
  }

  const body = doc.createElement('div');
  body.className = classNames.threadBody;

  const meta = doc.createElement('p');
  meta.className = classNames.threadMeta;

  const authorLink = doc.createElement('a');
  authorLink.className = classNames.threadAuthor;
  authorLink.href = sourceUrl || author.url || '#';
  authorLink.rel = 'nofollow noopener';
  authorLink.target = '_blank';
  authorLink.textContent = author.name;
  meta.appendChild(authorLink);
  meta.appendChild(doc.createTextNode(' '));

  const verb = doc.createElement('span');
  const property = normalizeProperty(mention['wm-property']);
  appendLabel(verb, labels[property] ?? getMentionType(mention, labels), doc);
  meta.appendChild(verb);

  if (formattedDate) {
    const time = doc.createElement('time');
    time.className = 'dt-published';
    time.dateTime = published;
    time.textContent = ` · ${formattedDate}`;
    meta.appendChild(time);
  }

  body.appendChild(meta);

  if (content || labels.fallbackContent) {
    const contentElement = doc.createElement('p');
    contentElement.className = classNames.threadContent;

    if (content) {
      contentElement.textContent = content;
    } else {
      appendLabel(contentElement, labels.fallbackContent, doc);
    }

    body.appendChild(contentElement);
  }

  if (sourceUrl && labels.viewSource) {
    const sourceLink = doc.createElement('a');
    sourceLink.className = classNames.threadSource;
    sourceLink.href = sourceUrl;
    sourceLink.rel = 'nofollow noopener';
    sourceLink.target = '_blank';
    appendLabel(sourceLink, labels.viewSource, doc);
    body.appendChild(sourceLink);
  }

  item.appendChild(body);

  return item;
}

/**
 * Paint an already-fetched feed. Split out from `renderWebmentions` so a site
 * can hydrate from a build-time snapshot without touching the network.
 */
export function renderGroups(groups, {
  container,
  facepile,
  list,
  labels = {},
  locale,
  classNames: classNameOverrides = {},
  facepileMode = 'flat',
  maxLength,
  // Timestamp of the snapshot these groups came from, if any. Rendering it
  // tells a reader how stale the list may be; on a live fetch, leave it unset.
  updatedAt = null,
  updated,
  document: doc = globalThis.document,
} = {}) {
  const classNames = {...DEFAULT_CLASS_NAMES, ...classNameOverrides};
  const containerElement = resolveElement(container, null, doc);
  const facepileElement = resolveElement(facepile, containerElement, doc)
    || containerElement?.querySelector(`.${classNames.facepile.split(' ')[0]}`);
  const listElement = resolveElement(list, containerElement, doc)
    || containerElement?.querySelector(`.${classNames.threadList.split(' ')[0]}`);

  if (facepileElement) {
    const children = facepileMode === 'grouped'
      ? FACEPILE_PROPERTIES
        .filter((property) => groups.byProperty?.[property]?.length)
        .map((property) => createFacepileGroup(property, groups.byProperty[property], {
          classNames,
          labels,
          doc,
        }))
      : groups.interactions.map((mention) => createFace(mention, classNames, doc));

    facepileElement.replaceChildren(...children);
    facepileElement.hidden = children.length === 0;
  }

  if (listElement) {
    listElement.replaceChildren(...groups.threads.map((mention) => createThreadItem(mention, {
      classNames,
      labels,
      locale,
      maxLength,
      doc,
    })));
  }

  const updatedElement = resolveElement(updated, containerElement, doc)
    || containerElement?.querySelector(`.${classNames.updated.split(' ')[0]}`);

  if (updatedElement) {
    const show = Boolean(updatedAt) && labels.updated != null
      && (groups.interactions.length > 0 || groups.threads.length > 0);

    updatedElement.replaceChildren();

    if (show) {
      appendLabel(updatedElement, labels.updated, doc);
      updatedElement.appendChild(doc.createTextNode(' '));

      const time = doc.createElement('time');
      time.dateTime = updatedAt;
      time.textContent = formatMentionDate(updatedAt, locale);
      updatedElement.appendChild(time);
    }

    updatedElement.hidden = !show;
  }

  if (containerElement) {
    const empty = !groups.interactions.length && !groups.threads.length;
    containerElement.hidden = empty;
    containerElement.setAttribute('aria-hidden', empty ? 'true' : 'false');
  }

  return groups;
}

/**
 * Fetch and render in one call.
 *
 * On failure the container is left untouched (so server-rendered or cached
 * markup survives an outage) and `onError` is invoked. The promise resolves
 * rather than rejects: a dead third-party API should not produce an unhandled
 * rejection on every page view.
 */
export async function renderWebmentions({
  container,
  facepile,
  list,
  targets,
  labels = {},
  locale,
  classNames = {},
  facepileMode = 'flat',
  maxLength,
  perPage,
  retries,
  retryDelayMs,
  fallbackToJson,
  apiUrl,
  jsonApiUrl,
  sortBy,
  sortDir,
  signal,
  onError,
  fetch: fetchImpl,
  document: doc = globalThis.document,
} = {}) {
  const containerElement = resolveElement(container, null, doc);

  if (!containerElement) {
    return {status: 'error', groups: null, error: new Error('No container element')};
  }

  try {
    const mentions = await fetchWebmentions({
      targets,
      apiUrl,
      jsonApiUrl,
      perPage,
      sortBy,
      sortDir,
      retries,
      retryDelayMs,
      fallbackToJson,
      signal,
      fetch: fetchImpl,
      document: doc,
    });
    const groups = groupWebmentions(mentions);

    renderGroups(groups, {
      container: containerElement,
      facepile,
      list,
      labels,
      locale,
      classNames,
      facepileMode,
      maxLength,
      document: doc,
    });

    return {status: 'success', groups, error: null};
  } catch (error) {
    if (error?.name === 'AbortError') {
      return {status: 'aborted', groups: null, error};
    }

    onError?.(error);

    return {status: 'error', groups: null, error};
  }
}
