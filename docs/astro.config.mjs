// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeBlack from 'starlight-theme-black'

export default defineConfig({
  site: 'https://horsemenofthehops.github.io',
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
