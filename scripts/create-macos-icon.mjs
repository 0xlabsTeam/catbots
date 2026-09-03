import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const iconChunks = [
  ['icp4', 'icon_16x16.png'],
  ['icp5', 'icon_32x32.png'],
  ['icp6', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'],
  ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'],
];

export async function createMacosIcon(iconsetDirectory, outputPath) {
  const chunks = await Promise.all(iconChunks.map(async ([type, name]) => {
    const image = await readFile(join(iconsetDirectory, name));
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(image.length + header.length, 4);
    return Buffer.concat([header, image]);
  }));
  const length = 8 + chunks.reduce((total, chunk) => total + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 4, 'ascii');
  header.writeUInt32BE(length, 4);
  await writeFile(outputPath, Buffer.concat([header, ...chunks], length));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [, , iconsetDirectory, outputPath] = process.argv;
  if (iconsetDirectory === undefined || outputPath === undefined) {
    throw new Error(`Usage: ${basename(process.argv[1])} <iconset-directory> <output.icns>`);
  }
  await createMacosIcon(iconsetDirectory, outputPath);
}
