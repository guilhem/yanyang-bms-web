import { mkdir, copyFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
await mkdir(new URL('web/vendor/', root), { recursive: true });
await copyFile(new URL('node_modules/i18next/dist/esm/i18next.js', root), new URL('web/vendor/i18next.js', root));
await copyFile(new URL('node_modules/i18next/LICENSE', root), new URL('web/vendor/i18next.LICENSE', root));
