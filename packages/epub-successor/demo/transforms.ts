import type { ContentTransform } from "../src/content-pipeline/content-pipeline";

const XHTML = "http://www.w3.org/1999/xhtml";
const SVG = "http://www.w3.org/2000/svg";

export const stressTransform: ContentTransform = (doc) => {
  const body = doc.body ?? doc.documentElement;
  for (let index = 0; index < 96; index += 1) {
    const paragraph = doc.createElementNS(XHTML, "p");
    const anchor = `stress-${index.toString().padStart(3, "0")}`;
    paragraph.id = anchor;
    paragraph.setAttribute("data-anchor", anchor);
    paragraph.textContent = `${anchor} Browser-authoritative layout keeps this deterministic paragraph visible across pages, spreads, preferences, and resizes.`;
    body.append(paragraph);
  }
};

export const securityTransform: ContentTransform = (doc) => {
  const body = doc.body ?? doc.documentElement;
  const script = doc.createElementNS(XHTML, "script");
  script.textContent = "window.__epubProbeScript = true; alert('probe')";
  const handler = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
  handler.id = "probe-handler";
  handler.setAttribute("onclick", "window.__epubProbeHandler = true");
  handler.textContent = "handler";
  const javascriptLink = doc.createElementNS(XHTML, "a") as HTMLAnchorElement;
  javascriptLink.id = "probe-javascript";
  javascriptLink.href = "javascript:window.__epubProbeJavascript=true";
  javascriptLink.textContent = "javascript";
  const dataLink = doc.createElementNS(XHTML, "a") as HTMLAnchorElement;
  dataLink.id = "probe-data";
  dataLink.href = "data:text/html,<script>top.__epubProbeData=true</script>";
  dataLink.textContent = "data";
  const topLink = doc.createElementNS(XHTML, "a") as HTMLAnchorElement;
  topLink.id = "probe-top";
  topLink.href = "#start";
  topLink.target = "_top";
  topLink.textContent = "top";
  const form = doc.createElementNS(XHTML, "form") as HTMLFormElement;
  form.id = "probe-form";
  form.setAttribute("action", "https://example.invalid/form");
  const submit = doc.createElementNS(XHTML, "button") as HTMLButtonElement;
  submit.type = "submit";
  submit.setAttribute("formaction", "https://example.invalid/submit");
  submit.textContent = "submit";
  form.append(submit);
  const refresh = doc.createElementNS(XHTML, "meta");
  refresh.setAttribute("http-equiv", "refresh");
  refresh.setAttribute("content", "0;url=https://example.invalid/refresh");
  (doc.head ?? doc.documentElement).append(refresh);
  const svg = doc.createElementNS(SVG, "svg");
  svg.id = "probe-svg";
  const svgScript = doc.createElementNS(SVG, "script");
  svgScript.textContent = "window.__epubProbeSvg=true";
  const foreignObject = doc.createElementNS(SVG, "foreignObject");
  foreignObject.textContent = "unsafe";
  const image = doc.createElementNS(SVG, "image");
  image.setAttribute("href", "https://example.invalid/vector.svg");
  svg.append(svgScript, foreignObject, image);
  body.append(script, handler, javascriptLink, dataLink, topLink, form, svg);
};
