/**
 * The smallest DOM that `render.js` needs. Keeping it here avoids a jsdom
 * dependency in a package that otherwise has none.
 */

class FakeNode {
  constructor(tagName, doc) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = doc;
    this.children = [];
    this.attributes = {};
    this.className = '';
    this.hidden = false;
    this._text = null;
  }

  set textContent(value) {
    this._text = String(value);
    this.children = [];
  }

  get textContent() {
    if (this._text !== null) {
      return this._text;
    }

    return this.children.map((child) => child.textContent).join('');
  }

  appendChild(child) {
    this._text = null;
    this.children.push(child);

    return child;
  }

  replaceChildren(...nodes) {
    this._text = null;
    this.children = nodes;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  querySelector(selector) {
    const wanted = selector.replace(/^[.#]/, '');

    return this.find((node) => (
      node.className.split(/\s+/).includes(wanted) || node.attributes.id === wanted
    ));
  }

  find(predicate) {
    for (const child of this.children) {
      if (predicate(child)) {
        return child;
      }

      const nested = child.find?.(predicate);
      if (nested) {
        return nested;
      }
    }

    return null;
  }

  flatten() {
    return this.children.flatMap((child) => [child, ...(child.flatten?.() || [])]);
  }
}

class FakeText extends FakeNode {
  constructor(text) {
    super('#text');
    this._text = String(text);
  }

  find() {
    return null;
  }

  flatten() {
    return [];
  }
}

export function createFakeDocument() {
  const doc = {
    createElement: (tagName) => new FakeNode(tagName, doc),
    createTextNode: (text) => new FakeText(text),
    querySelector: () => null,
  };

  return doc;
}

export {FakeNode};
