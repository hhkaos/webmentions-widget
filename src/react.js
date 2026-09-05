/**
 * Optional React entry point.
 *
 * Written with `createElement` rather than JSX so the package stays
 * buildless — consumers import the source directly.
 */

import {createElement as h, useCallback, useEffect, useMemo, useState} from 'react';
import {
  FACEPILE_PROPERTIES,
  describeTimestamp,
  fetchWebmentions,
  filterMentionsByTargets,
  formatMentionDate,
  getMentionAuthor,
  getMentionContent,
  getMentionSourceUrl,
  getMentionType,
  getSnapshotMentions,
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
    // A whole-site snapshot, narrowed to these targets locally.
    snapshot,
    // With mentions already in hand, skip the network by default: the point of
    // a snapshot is that a page view costs webmention.io nothing.
    revalidate,
  } = options;
  const targetsKey = targets.join('\n');

  // Derived, not stored: on a client-side route change the targets change, and
  // state seeded once in a useState initializer would go stale.
  const seededGroups = useMemo(() => {
    if (initialMentions) {
      return groupWebmentions(initialMentions);
    }

    if (!snapshot) {
      return null;
    }

    return groupWebmentions(
      filterMentionsByTargets(getSnapshotMentions(snapshot), targetsKey ? targetsKey.split('\n') : []),
    );
  }, [initialMentions, snapshot, targetsKey]);

  const shouldFetch = (revalidate ?? !seededGroups) && Boolean(targetsKey);
  const [fetched, setFetched] = useState({status: 'idle', groups: null, error: null});

  useEffect(() => {
    if (!shouldFetch) {
      return undefined;
    }

    const controller = new AbortController();
    let active = true;

    setFetched({status: 'loading', groups: null, error: null});

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
          setFetched({status: 'success', groups: groupWebmentions(mentions), error: null});
        }
      })
      .catch((error) => {
        if (active && error?.name !== 'AbortError') {
          setFetched({status: 'error', groups: null, error});
        }
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [targetsKey, shouldFetch, apiUrl, perPage, retries, retryDelayMs, fallbackToJson]);

  // A live result wins once it lands; until then the snapshot renders. A failed
  // revalidation never blanks a section the snapshot could still fill.
  if (fetched.groups) {
    return {...fetched, source: 'network', generatedAt: null};
  }

  if (seededGroups) {
    return {
      status: 'success',
      groups: seededGroups,
      error: fetched.error,
      source: 'snapshot',
      // Only meaningful for a snapshot: how stale the data on screen may be.
      generatedAt: initialMentions ? null : snapshot?.generatedAt ?? null,
    };
  }

  return {
    status: fetched.status,
    groups: EMPTY_GROUPS,
    error: fetched.error,
    source: null,
    generatedAt: null,
  };
}

/**
 * A label is a plain string, or a `{en, es}` map for sites that ship both
 * languages and toggle them with CSS.
 */
function renderLabel(label, keyPrefix) {
  if (label == null || typeof label === 'string') {
    return label ?? null;
  }

  return Object.entries(label).map(([lang, text]) => h(
    'span',
    {key: `${keyPrefix}-${lang}`, className: `i18n-${lang}`, lang},
    text,
  ));
}

/**
 * Every mention gets an avatar-shaped element, photo or not: a row that
 * sometimes starts with a 40px image and sometimes with nothing has two
 * different layouts, and the one without reads as a rendering failure.
 */
function Avatar({author, className, fallbackClassName, size}) {
  if (author.photo) {
    return h('img', {
      className,
      src: author.photo,
      alt: '',
      loading: 'lazy',
      width: size,
      height: size,
    });
  }

  return h(
    'span',
    {
      className: fallbackClassName,
      'aria-hidden': 'true',
      style: {'--webmention-avatar-hue': author.hue},
    },
    author.initial,
  );
}

function Face({mention, classNames}) {
  const author = getMentionAuthor(mention);
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
        title: `${author.name} — ${getMentionType(mention)}`,
      },
      h(Avatar, {
        author,
        className: classNames.facepilePhoto,
        fallbackClassName: classNames.facepileInitial,
        size: 32,
      }),
    ),
  );
}

function Thread({mention, classNames, labels, locale, maxLength}) {
  const author = getMentionAuthor(mention);
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
    h(Avatar, {
      author,
      className: classNames.threadPhoto,
      fallbackClassName: classNames.threadInitial,
      size: 40,
    }),
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
          h('span', {className: 'p-name'}, author.name),
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

/**
 * "Updated 3 hours ago" while the snapshot is fresh, an absolute date once it
 * is not. The exact moment is always reachable: as a tooltip on hover, and by
 * clicking — hover does not exist on touch.
 */
function UpdatedLine({className, generatedAt, locale, label, render}) {
  const [expanded, setExpanded] = useState(false);
  const toggle = useCallback(() => setExpanded((previous) => !previous), []);
  const {label: relative, exact, isRelative} = useMemo(
    () => describeTimestamp(generatedAt, locale),
    [generatedAt, locale],
  );

  if (render) {
    return h('p', {className}, render(generatedAt, relative, exact));
  }

  return h(
    'p',
    {className},
    renderLabel(label, 'updated'),
    ' ',
    h(
      'time',
      {
        dateTime: generatedAt,
        title: exact,
        onClick: isRelative ? toggle : undefined,
        role: isRelative ? 'button' : undefined,
        tabIndex: isRelative ? 0 : undefined,
        onKeyDown: isRelative
          ? (event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              toggle();
            }
          }
          : undefined,
        style: isRelative ? {cursor: 'pointer'} : undefined,
      },
      expanded ? exact : relative,
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
  facepileInitial: 'webmention-facepile-photo is-initial',
  threadList: 'webmentions-list',
  threadItem: 'h-cite webmention',
  threadPhoto: 'webmention-photo',
  threadInitial: 'webmention-photo is-initial',
  threadBody: 'webmention-body',
  threadMeta: 'webmention-meta',
  threadAuthor: 'p-author h-card u-url',
  threadContent: 'e-content webmention-content',
  threadSource: 'u-url webmention-source',
  updated: 'webmentions-updated',
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
  renderUpdated = null,
  ...options
}) {
  const classNames = {...REACT_CLASS_NAMES, ...classNameOverrides};
  const {status, groups, error, source, generatedAt} = useWebmentions(targets, options);

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
    // Only when rendering from a snapshot: on a live fetch the mentions are
    // current and dating them would be misleading.
    source === 'snapshot' && generatedAt && (labels.updated || renderUpdated)
      ? h(UpdatedLine, {
        key: 'updated',
        className: classNames.updated,
        generatedAt,
        locale,
        label: labels.updated,
        render: renderUpdated,
      })
      : null,
  ];

  return h(
    'aside',
    {className: classNames.root, 'aria-labelledby': `${classNames.title}-heading`},
    innerClassName ? h('div', {className: innerClassName}, children) : children,
  );
}

export default Webmentions;
