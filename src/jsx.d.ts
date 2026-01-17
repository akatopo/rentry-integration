declare namespace JSX {
  type Element = DocumentFragment;

  interface Attributes {
    [attrib: string]: unknown;
  }

  interface IntrinsicElements {
    [elem: string]: Attributes;
  }
}
