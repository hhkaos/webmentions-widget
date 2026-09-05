/**
 * Optional React entry point.
 *
 * Written with `createElement` rather than JSX so the package stays
 * buildless — consumers import the source directly.
 */

import {createElement as h, useEffect, useMemo, useRef, useState} from 'react';
import {
  FACEPILE_PROPERTIES,
  fetchWebmentions,
  formatMentionDate,
  getMentionContent,
  getMentionSourceUrl,
  getMentionType,
  groupWebmentions,
} from './core.js';

const EMPTY_GROUPS = {
  interactions: [],
  threads: [],
  byProperty: Object.fromEntries(FACEPILE_PROPERTIES.map((property) => [property, []])),
  counts: {},
  total: 0,
};

/**
 * Fetch mentions for `targets` and keep them in state.
 *
 * `status` distinguishes `'error'` from an empty `'success'`, so a caller can
 * keep the section mounted during a webmention.io outage instead of silently
 * unmounting it.
 */
export function useWebmentions(targets, options = {}) {
  const {
    apiUrl,
    perPage,
    retries,
    retryDelayMs,
    fallbackToJson,
    initialMentions,
  } = options;
  const [state, setState] = useState(() => ({
    status: initialMentions ? 'success' : 'idle',
    groups: initialMentions ? groupWebmentions(initialMentions) : EMPTY_GROUPS,
    error: null,
  }));
  const targetsKey = targets.join('\n');
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    if (!targetsKey) {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    setState((previous) => ({...previous, status: 'loading'}));

    fetchWebmentions({
      targets: targetsKey.split('\n'),
      apiUrl,
      perPage,
      retries,
      retryDelayMs,
      fallbackToJson,
      signal: controller.signal,
    })
      .then((mentions) => {
        if (active) {
          setState({status: 'success', groups: groupWebmentions(mentions), error: null});
        }
      })
      .catch((error) => {
        if (active && error?.name !== 'AbortError') {
          setState({status: 'error', groups: EMPTY_GROUPS, error});
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [targetsKey, apiUrl, perPage, retries, retryDelayMs, fallbackToJson]);

  return state;
}

function Face({mention, classNames}) {
  const author = mention.author || {};
  const sourceUrl = mention.url || mention['wm-source'] || author.url;

  return h(
    'li',
    {className: classNames.facepileItem},
    h(
      'a',
      {
        className: classNames.facepileLink,
        href: sourceUrl,
        rel: 'nofollow noopener',
        target: '_blank',
        title: `${author.name || 'Someone'} — ${getMentionType(mention)}`,
      },
      author.photo
        ? h('img', {
          className: classNames.facepilePhoto,
          src: author.photo,
          alt: '',
          loading: 'lazy',
          width: 32,
          height: 32,
        })
        : h('span', {'aria-hidden': 'true'}, (author.name || '?').slice(0, 1).toUpperCase()),
    ),
  );
}

function Thread({mention, classNames, labels, locale, maxLength}) {
  const author = mention.author || {};
  const published = mention.published || mention['wm-received'];
  const formattedDate = formatMentionDate(published, locale);
  const content = useMemo(
    () => getMentionContent(mention, {maxLength}),
    [mention, maxLength],
  );
  const sourceUrl = getMentionSourceUrl(mention, content);

  return h(
    'li',
    {className: classNames.threadItem},
    author.photo
      ? h('img', {
        className: classNames.threadPhoto,
        src: author.photo,
        alt: '',
        loading: 'lazy',
        width: 40,
        height: 40,
      })
      : null,
    h(
      'div',
      {className: classNames.threadBody},
      h(
        'p',
        {className: classNames.threadMeta},
        h(
          'a',
          {
            className: classNames.threadAuthor,
            href: sourceUrl || author.url,
            rel: 'nofollow noopener',
            target: '_blank',
          },
          h('span', {className: 'p-name'}, author.name || mention.url),
        ),
        ' ',
        h('span', null, getMentionType(mention, labels)),
        formattedDate
          ? h('time', {className: 'dt-published', dateTime: published}, ` · ${formattedDate}`)
          : null,
      ),
      content ? h('p', {className: classNames.threadContent}, content) : null,
      mention.url ? h('a', {className: classNames.threadSource, href: sourceUrl}, mention.url) : null,
    ),
  );
}

const REACT_CLASS_NAMES = {
  root: 'webmentions',
  title: 'webmentions-title',
  facepile: 'webmentions-facepile',
  facepileItem: 'webmention-facepile-item',
  facepileLink: 'webmention-facepile-link',
  facepilePhoto: 'webmention-facepile-photo',
  threadList: 'webmentions-list',
  threadItem: 'h-cite webmention',
  threadPhoto: 'webmention-photo',
  threadBody: 'webmention-body',
  threadMeta: 'webmention-meta',
  threadAuthor: 'p-author h-card u-url',
  threadContent: 'e-content webmention-content',
  threadSource: 'u-url webmention-source',
};

/**
 * Presentational component. Pass `targets` (build them with
 * `getCanonicalTargets`) — routing and site config stay in the host app.
 */
export function Webmentions({
  targets = [],
  title = 'Webmentions',
  labels = {},
  locale,
  maxLength,
  classNames: classNameOverrides = {},
  // Optional wrapper inside the <aside>, for hosts whose layout CSS keys off a
  // width-constraining element (Docusaurus's `.container`, for example).
  innerClassName = null,
  renderEmpty = null,
  renderError = null,
  ...options
}) {
  const classNames = {...REACT_CLASS_NAMES, ...classNameOverrides};
  const {status, groups, error} = useWebmentions(targets, options);

  if (status === 'error') {
    return renderError ? renderError(error) : null;
  }

  if (status !== 'success') {
    return null;
  }

  if (!groups.interactions.length && !groups.threads.length) {
    return renderEmpty ? renderEmpty() : null;
  }

  const children = [
    h('h2', {key: 'title', id: `${classNames.title}-heading`, className: classNames.title}, title),
    groups.interactions.length
      ? h(
        'ol',
        {key: 'facepile', className: classNames.facepile, 'aria-label': 'Reactions'},
        groups.interactions.map((mention) => h(Face, {
          key: mention['wm-id'] || mention.url || mention['wm-source'],
          mention,
          classNames,
        })),
      )
      : null,
    groups.threads.length
      ? h(
        'ol',
        {key: 'threads', className: classNames.threadList},
        groups.threads.map((mention) => h(Thread, {
          key: mention['wm-id'] || mention.url || mention['wm-source'],
          mention,
          classNames,
          labels,
          locale,
          maxLength,
        })),
      )
      : null,
  ];

  return h(
    'aside',
    {className: classNames.root, 'aria-labelledby': `${classNames.title}-heading`},
    innerClassName ? h('div', {className: innerClassName}, children) : children,
  );
}

export default Webmentions;
