const [major] = process.versions.node.split('.').map(Number);
if (major !== 22) {
  throw new Error(`Catbots packaging requires Node.js 22.x; found ${process.versions.node}. Activate a supported Node 22 installation and retry.`);
}
