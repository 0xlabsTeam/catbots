import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const renderer = resolve(root, 'apps/desktop/src/renderer');
const tokensPath = resolve(renderer, 'design-system/tokens.css');
const tokens = await readFile(tokensPath, 'utf8');
const defined = new Set([...tokens.matchAll(/(--cb-[\w-]+)\s*:/g)].map((match) => match[1]));
const failures = [];
const report = (file, rule) => failures.push(`${relative(root, file)}: ${rule}`);
async function inspect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (entry.isDirectory()) { await inspect(file); continue; }
    if (!/\.(css|tsx)$/.test(file)) continue;
    const source = (await readFile(file, 'utf8')).replace(/\/\*[\s\S]*?\*\//g, '');
    if (file === tokensPath) continue;
    if (file.endsWith('.css')) {
      if (/#[\da-f]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|light-dark)\(/i.test(source)) report(file, 'Define palette values in design-system/tokens.css.');
      if (/--cb-[\w-]+\s*:/.test(source)) report(file, 'Define Catbots tokens only in tokens.css.');
      for (const [, property, value] of source.matchAll(/\b(font-size|font-family|font-weight|line-height|letter-spacing|border-radius|z-index)\s*:\s*([^;{}]+)[;}]/g)) {
        if (!/^(?:var\(--[\w-]+\)|inherit|normal|0)$/.test(value.trim())) report(file, `${property} must use a shared token (found ${value.trim()}).`);
      }
    } else {
      const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      function checkControls(node) {
        if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
          && ['Button', 'Input', 'Select'].includes(node.tagName.getText(ast))
          && !node.attributes.properties.some((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === 'size')) {
          report(file, `${node.tagName.getText(ast)} must declare a Kumo size (sm for compact toolbars, base for forms).`);
        }
        ts.forEachChild(node, checkControls);
      }
      checkControls(ast);
      if (/<(?:button|input|textarea|select|option|dialog|details|summary|a|pre|table|progress|svg)\b/.test(source)) report(file, 'Use Kumo components for controls, tables, code and charts; native custom primitives are not allowed.');
      if (/\b(?:fontSize|fontFamily|fontWeight|lineHeight|letterSpacing)\s*:/.test(source)) report(file, 'Use CSS typography tokens instead of inline typography.');
      if (/\btext-\[/.test(source)) report(file, 'Use the shared type scale instead of arbitrary text utilities.');
      if (!file.endsWith('/BrandLogo.tsx') && /assets\/(?:icon|logo)[\w.-]*\.(?:png|svg)|\bCatIcon\b/.test(source)) report(file, 'Use BrandLogo for the Catbots identity.');
    }
    for (const [, token] of source.matchAll(/var\((--cb-[\w-]+)/g)) {
      if (!defined.has(token)) report(file, `Undefined token ${token}.`);
    }
  }
}
await inspect(renderer);
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log('Design system: palette, typography, radii, layers, token references and logo usage passed.');
