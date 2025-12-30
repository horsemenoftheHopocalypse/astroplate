// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeBlack from 'starlight-theme-black'

export default defineConfig({
  //base: '/docs/',
  site: 'https://horsemenoftheHopocalypse.github.io/astroplate/',
  // if the docs site is served at the repo root on Pages, omit base
  // base: '/<something>'   // only needed if you serve from a sub-path
  integrations: [
    starlight({
      plugins: [
        starlightThemeBlack({
          footerText: //optional
            '© 2026 Horsemen of the Hopocalypse. All rights reserved.',
        })
      ],
      title: 'Horsemen of the Hops Docs',
    }),
  ],
});
