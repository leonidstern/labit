// The build imports .css files as text (esbuild --loader:.css=text).
declare module '*.css' {
  const css: string;
  export default css;
}
// true in the co-labit build (scripts/build-widget.mjs --co), false in the lab's.
declare var __LAB_CO__: boolean | undefined;
