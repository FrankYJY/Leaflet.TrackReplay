import buble from '@rollup/plugin-buble';
import terser from '@rollup/plugin-terser';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'));

// Banner with version and license info
const banner = `/*!
 * ${pkg.name} v${pkg.version}
 * ${pkg.description}
 * (c) ${new Date().getFullYear()} ${pkg.author}
 * Released under the ${pkg.license} License.
 *
 * Requires Leaflet ^1.7.0
 */`;

const globals = {
  leaflet: 'L',
};

const external = ['leaflet'];

export default [
  // UMD build (for <script> tags, AMD, CommonJS)
  {
    input: 'src/TrackReplay.js',
    output: {
      file: `dist/${pkg.name}.umd.js`,
      format: 'umd',
      name: 'L.TrackReplay',
      globals,
      banner,
      sourcemap: true,
      exports: 'named',
    },
    external,
    plugins: [buble()],
  },

  // IIFE build (standalone, minified — CDN-friendly)
  {
    input: 'src/TrackReplay.js',
    output: {
      file: `dist/${pkg.name}.iife.js`,
      format: 'iife',
      name: 'L.TrackReplay',
      globals,
      banner,
      sourcemap: true,
      exports: 'named',
    },
    external,
    plugins: [buble(), terser()],
  },

  // ESM build (for bundlers that understand ES modules)
  {
    input: 'src/TrackReplay.js',
    output: {
      file: `dist/${pkg.name}.esm.js`,
      format: 'es',
      banner,
      sourcemap: true,
    },
    external,
    plugins: [buble()],
  },

  // CommonJS build (for Node / older bundlers)
  {
    input: 'src/TrackReplay.js',
    output: {
      file: pkg.main,
      format: 'cjs',
      banner,
      sourcemap: true,
      exports: 'named',
    },
    external,
    plugins: [buble()],
  },
];
