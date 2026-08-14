/**
 * Browser-half bundle: src/client/index.ts -> lib/client.js. The shell loads
 * plugin code through `window.__ModuleLoader__.load({ id, factory })`; the
 * factory's `require` resolves platform modules (react) from the frozen
 * module table, so they stay external and every other import inlines.
 * The node half ships from tsc (tsconfig.build.json); this config only
 * produces the client artifact.
 */

/** @type {import('tsdown').UserConfig[]} */
export default [
  {
    name: 'dsh-snapshot/client',
    entry: { client: 'src/client/index.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    // The module table the loader requires against: react and its JSX runtime
    // entry are the only value imports this bundle makes, so they stay external.
    // `@deepseek-ai/dsh-client-runtime/client` also stays external: its built
    // declarations carry .ts-suffixed relative imports rolldown cannot follow,
    // and the snapshot-store engine it exports is answered at runtime by the
    // loader's module table (the runtime plugin mounts before this bundle).
    // `@deepseek-ai/dsh-client-ui-primitives` stays external for the same
    // .tsx-suffixed declaration quirk; its icon components resolve from the
    // loader's module table at runtime.
    // Every other @deepseek-ai import is type-only and erased at build time.
    external: [
      'react',
      'react/jsx-runtime',
      'react/jsx-dev-runtime',
      '@deepseek-ai/dsh-client-runtime/client',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    noExternal: (id) => (id.startsWith('@deepseek-ai/')
      && id !== '@deepseek-ai/dsh-client-runtime/client'
      && id !== '@deepseek-ai/dsh-client-ui-primitives' ? true : undefined),
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: 'dsh-snapshot', factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
]
