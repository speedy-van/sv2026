import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import reactNativePlugin from 'eslint-plugin-react-native';
import baseConfig from './base.js';

export default [
  ...baseConfig,
  {
    files: ['apps/admin/**/*.{ts,tsx}', 'apps/driver/**/*.{ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'react-native': reactNativePlugin,
    },
    rules: {
      ...reactPlugin.configs.flat.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...reactNativePlugin.configs.all.rules,
      'react/react-in-jsx-scope': 'off',
      'react-native/no-raw-text': 'off'
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
  },
];
