import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/*
 * Enforcement of the "design tokens are the single source of truth" rule
 * (frontend steering §9 / task 17.1): raw hex colors and raw `px` font-size
 * declarations are forbidden in `.tsx` component files outside `/styles/tokens`.
 * Kiro-generated code fails lint if it hardcodes a color or font size instead of
 * importing a token.
 */
const HEX_RE = /#[0-9a-fA-F]{3,6}\b/;
const PX_FONT_SIZE_RE = /font-size\s*:\s*[\d.]+px/i;
const PX_VALUE_RE = /^[\d.]+px$/;

/** @type {import('eslint').Rule.RuleModule} */
const noRawDesignValues = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow raw hex colors and raw px font-size declarations outside /styles/tokens; import a design token instead.',
    },
    schema: [],
    messages: {
      rawHex:
        'Raw hex color "{{value}}" is not allowed. Import a color token from "@/styles/tokens" or use a token-derived Tailwind utility.',
      rawPxFontSize:
        'Raw px font-size "{{value}}" is not allowed. Use a typography token from "@/styles/tokens".',
    },
  },
  create(context) {
    /**
     * @param {import('eslint').Rule.Node} node
     * @param {string} raw
     */
    const checkString = (node, raw) => {
      if (HEX_RE.test(raw)) {
        context.report({ node, messageId: 'rawHex', data: { value: raw } });
      }
      if (PX_FONT_SIZE_RE.test(raw)) {
        context.report({
          node,
          messageId: 'rawPxFontSize',
          data: { value: raw },
        });
      }
    };

    return {
      Literal(node) {
        if (typeof node.value === 'string') {
          checkString(node, node.value);
        }
      },
      TemplateElement(node) {
        checkString(node, node.value.raw);
      },
      // Catch inline style objects, e.g. `style={{ fontSize: '12px' }}`.
      Property(node) {
        const key = node.key;
        const name =
          key.type === 'Identifier'
            ? key.name
            : key.type === 'Literal'
              ? key.value
              : undefined;
        if (
          name === 'fontSize' &&
          node.value.type === 'Literal' &&
          typeof node.value.value === 'string' &&
          PX_VALUE_RE.test(node.value.value)
        ) {
          context.report({
            node: node.value,
            messageId: 'rawPxFontSize',
            data: { value: node.value.value },
          });
        }
      },
    };
  },
};

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'coverage'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': [
        'warn',
        { allowConstantExport: true },
      ],
    },
  },
  // The design-token guard: only .tsx component files, never /styles/tokens.
  {
    files: ['src/**/*.tsx'],
    ignores: ['src/styles/tokens/**'],
    plugins: {
      wren: { rules: { 'no-raw-design-values': noRawDesignValues } },
    },
    rules: {
      'wren/no-raw-design-values': 'error',
    },
  },
);
