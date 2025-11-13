declare namespace JSX {
  type Element = DocumentFragment;

  interface Attributes {
    [attrib: string]: string;
  }

  interface IntrinsicElements {
    [elem: string]: Attributes;
  }
}
