module.exports = {
  presets: [
    [
      '@babel/preset-env',
      {
        modules: process.env.BABEL_OUTPUT === 'esm' ? false : 'commonjs',
        targets: { browsers: ['last 3 chrome versions', 'last 3 firefox versions'] },
      },
    ],
    ['@babel/preset-react', { runtime: 'automatic' }],
    '@babel/preset-typescript',
  ],
};
