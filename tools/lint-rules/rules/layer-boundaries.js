'use strict';

const path = require('node:path');

// Dependency order, lowest first. A file may import from its own layer or
// any layer earlier in this list, never a later one.
const LAYER_ORDER = ['kernel', 'platform', 'editor', 'extension-host', 'workbench', 'host'];

function layerOf(absFilePath, absSrcRoot) {
  const rel = path.relative(absSrcRoot, absFilePath);
  if (rel.startsWith('..')) return null; // outside srcRoot entirely
  const first = rel.split(path.sep)[0];
  return LAYER_ORDER.includes(first) ? first : null;
}

function checkSource(context, node, source, srcRoot) {
  if (typeof source !== 'string' || !source.startsWith('.')) return; // only same-app relative imports are layer-checked

  const filename = context.getFilename();
  const fromLayer = layerOf(path.resolve(filename), srcRoot);
  if (!fromLayer) return; // this file isn't inside a recognized layer folder

  const resolvedTarget = path.resolve(path.dirname(filename), source);
  const toLayer = layerOf(resolvedTarget, srcRoot);
  if (!toLayer || toLayer === fromLayer) return;

  if (LAYER_ORDER.indexOf(toLayer) > LAYER_ORDER.indexOf(fromLayer)) {
    context.report({
      node,
      messageId: 'violation',
      data: { from: fromLayer, to: toLayer, order: LAYER_ORDER.join(' < ') },
    });
  }
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow imports from a higher layer into a lower one, enforcing kernel < platform < editor < extension-host < workbench < host.',
    },
    schema: [
      {
        type: 'object',
        properties: { srcRoot: { type: 'string' } },
        additionalProperties: false,
      },
    ],
    messages: {
      violation:
        'Layer "{{from}}" may not import from layer "{{to}}". Allowed dependency order is: {{order}}.',
    },
  },
  create(context) {
    const options = context.options[0] || {};
    const srcRoot = path.resolve(context.getCwd(), options.srcRoot || 'src');

    return {
      ImportDeclaration(node) {
        checkSource(context, node, node.source.value, srcRoot);
      },
      ExportNamedDeclaration(node) {
        if (node.source) checkSource(context, node, node.source.value, srcRoot);
      },
      ExportAllDeclaration(node) {
        checkSource(context, node, node.source.value, srcRoot);
      },
      CallExpression(node) {
        const isDynamicImport = node.callee.type === 'Import';
        const isRequire = node.callee.type === 'Identifier' && node.callee.name === 'require';
        if (!isDynamicImport && !isRequire) return;
        const arg = node.arguments[0];
        if (arg && arg.type === 'Literal' && typeof arg.value === 'string') {
          checkSource(context, node, arg.value, srcRoot);
        }
      },
    };
  },
};
