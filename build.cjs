const path = require('path');
require('esbuild').buildSync({
  entryPoints: [path.join(__dirname, 'scene.js')],
  outfile: path.join(__dirname, 'app.js'),
  bundle: true,
  minify: true,
  format: 'iife',
  legalComments: 'none',
});
