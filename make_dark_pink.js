const fs = require('fs');

const replacements = [
  {
    file: 'src/App.js',
    replaces: [
      { from: 'mode: "light"', to: 'mode: "dark"' },
      { from: 'bg-pink-50 text-gray-800', to: 'bg-[#130b0e] text-pink-50' }
    ]
  },
  {
    file: 'src/css/index.css',
    replaces: [
      { from: 'bg-pink-50 text-gray-800', to: 'bg-[#130b0e] text-pink-50' },
      { from: 'bg-pink-50', to: 'bg-[#130b0e]' }
    ]
  },
  {
    file: 'src/navbar/Navbar.js',
    replaces: [
      { from: 'bg-white/60', to: 'bg-[#23151a]/80' },
      { from: 'border-pink-200', to: 'border-pink-500/20' }
    ]
  },
  {
    file: 'src/vods/Vod.js',
    replaces: [
      { from: 'bg-white/80', to: 'bg-[#23151a]/80' },
      { from: /border-pink-200/g, to: 'border-pink-500/20' },
      { from: 'from-white/50 to-pink-50/50', to: 'from-[#23151a]/50 to-[#130b0e]/50' }
    ]
  },
  {
    file: 'src/vods/Vods.js',
    replaces: [
      { from: /bg-white\/50/g, to: 'bg-[#130b0e]/50' },
      { from: /border-pink-200/g, to: 'border-pink-500/20' },
      { from: /bg-white\/95/g, to: 'bg-[#23151a]/95' },
      { from: /bg-white\/80/g, to: 'bg-[#23151a]/80' },
      { from: /text-gray-800/g, to: 'text-pink-50' }
    ]
  }
];

replacements.forEach(({ file, replaces }) => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    replaces.forEach(({ from, to }) => {
      if (typeof from === 'string') {
        content = content.split(from).join(to);
      } else {
        content = content.replace(from, to);
      }
    });
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated to dark pink theme in ${file}`);
  }
});
