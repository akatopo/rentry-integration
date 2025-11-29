type HTMLElementWithProps = HTMLElement & {
  props: Record<string, unknown>;
};

export function h(
  type:
    | typeof Fragment
    | ((
        props: Record<string, unknown> | undefined,
        children: [unknown],
      ) => DocumentFragment)
    | string,
  props?: Record<string, unknown>,
  ...children: [Node | string]
) {
  if (type === Fragment) {
    return (type as typeof Fragment)(children);
  }
  if (typeof type === 'function') {
    return type(props, children);
  }

  const el = createElementWithProps(type);

  Object.entries(props ?? {}).forEach(([name, value]) => {
    if (name.length > 1 && name[0] === '_') {
      el.props[name.slice(1)] = value;
    }
    if (name.length > 1 && name[0] === '$') {
      if (typeof value !== 'function') {
        console.error(`value for ${name} is not a function`, el);
        return;
      }
      el.addEventListener(name.slice(1), (e) => {
        return value(e);
      });
    } else {
      el.setAttribute(name, String(value));
    }
  });

  children.forEach((c) => {
    asArray(c).forEach((cc) => {
      el.appendChild(typeof cc === 'string' ? document.createTextNode(cc) : cc);
    });
  });

  return el;
}

export function Fragment(children: unknown) {
  const fragment = document.createDocumentFragment();

  asArray(children).forEach((x) => {
    if (typeof x === 'string') {
      fragment.appendChild(document.createTextNode(x));
    } else if (x instanceof Element || x instanceof DocumentFragment) {
      fragment.appendChild(x);
    } else if (Array.isArray(x)) {
      fragment.appendChild(Fragment(x));
    } else {
      console.error(x);
    }
  });

  return fragment;
}

function createElementWithProps(type: string) {
  const el = document.createElement(type) as HTMLElementWithProps;
  el.props = {};

  return el;
}

function asArray<T>(x: T) {
  return [x].flat();
}
