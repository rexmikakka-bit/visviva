// Launcher-only artwork preparation. Does not regenerate splash, favicon or in-app marks.
// Run with sharp installed: node scripts/build-launcher-icons.mjs
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import sharp from 'sharp';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const source=join(root,'promotional-assets/abyssal-integration-2026-09-11/axis-abyssal-corner-v3-1024.png');
const metadata=await sharp(source).metadata();
if(metadata.width!==1024||metadata.height!==1024||metadata.hasAlpha)
  throw new Error('Launcher master must be an opaque 1024px square');
writeFileSync(join(root,'assets/icon-only.png'),readFileSync(source));
// The smaller inset triangle was approved on iOS; both launchers use this master.
const android=readFileSync(source);
writeFileSync(join(root,'assets/icon-foreground.png'),android);
const scales={ldpi:[36,81],mdpi:[48,108],hdpi:[72,162],xhdpi:[96,216],xxhdpi:[144,324],xxxhdpi:[192,432]};
for(const [density,[legacy,adaptive]] of Object.entries(scales)){
  const dir=join(root,`android/app/src/main/res/mipmap-${density}`);mkdirSync(dir,{recursive:true});
  await sharp(android).resize(legacy,legacy).toFile(join(dir,'ic_launcher.png'));
  await sharp(android).resize(legacy,legacy).composite([{input:Buffer.from(
    `<svg width="${legacy}" height="${legacy}"><circle cx="${legacy/2}" cy="${legacy/2}" r="${legacy/2}" fill="white"/></svg>`),blend:'dest-in'}])
    .png().toFile(join(dir,'ic_launcher_round.png'));
  await sharp(android).resize(adaptive,adaptive).toFile(join(dir,'ic_launcher_foreground.png'));
}
console.log('Prepared opaque iOS master and Android launcher assets in all six densities.');
