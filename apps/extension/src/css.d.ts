// Stylesheets imported by the content script are bundled as text (esbuild `text` loader) for its shadow root.
declare module '*.css' {
  const css: string;
  export default css;
}
