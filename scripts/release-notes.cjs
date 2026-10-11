const fs = require('node:fs');
const path = require('node:path');

function releaseNotes(repository, tag, assets, notes) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository) || !/^v\d+\.\d+\.\d+$/.test(tag)) throw new Error('Invalid repository or release tag');
  const platforms = [
    ['macOS (Apple Silicon)', 'Download DMG', 'apple', name => name.endsWith('-arm64.dmg')],
    ['Windows (64-bit)', 'Download installer', 'windows', name => name.endsWith('.exe')],
    ['Linux (64-bit)', 'Download AppImage', 'linux', name => name.endsWith('.AppImage')],
    ['Linux (portable)', 'Download archive', 'linux', name => name.endsWith('.tar.gz')],
  ];
  const rows = platforms.map(([platform, label, logo, matches]) => {
    const files = assets.filter(matches);
    if (files.length !== 1) throw new Error(`Expected one download for ${platform}, found ${files.length}`);
    const url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(files[0])}`;
    const badge = `https://img.shields.io/badge/${encodeURIComponent(label.replace(/-/g, '--'))}-5865F2?style=for-the-badge&logo=${logo}&logoColor=white`;
    return `| ${platform} | [![${label}](${badge})](${url}) |`;
  });
  if (!notes.trim()) throw new Error('Release notes cannot be empty');
  return `## Download\n\nChoose the package for your computer.\n\n| Platform | Download |\n| --- | --- |\n${rows.join('\n')}\n\n## What changed\n\n${notes.trim()}\n\n[Installation help](https://github.com/${repository}/blob/${tag}/README.md#download)\n`;
}

if (require.main === module) {
  const [repository, tag, directory] = process.argv.slice(2);
  const notes = fs.readFileSync(path.join(__dirname, '../docs/releases', `${tag}.md`), 'utf8');
  process.stdout.write(releaseNotes(repository, tag, fs.readdirSync(directory), notes));
}
module.exports = { releaseNotes };
