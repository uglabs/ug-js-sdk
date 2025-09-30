const path = require('path');

module.exports = {
  entry: './src/index.ts',
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  output: {
    filename: 'ug-js-sdk-bundle.js',
    path: path.resolve(__dirname, 'dist'),
    library: 'uglabs',
    libraryTarget: 'umd',
    globalObject: 'this',
  },
};
