const fs = require('fs');

const replacements = [
  {
    file: 'src/App.js',
    replaces: [
      { from: 'mode: "dark"', to: 'mode: "light"' },
      { from: 'bg-dark-900 text-gray-200', to: 'bg-pink-50 text-gray-800' }
    ]
  },
  {
    file: 'src/css/index.css',
    replaces: [
      { from: 'bg-dark-900 text-gray-200', to: 'bg-pink-50 text-gray-800' },
      { from: 'bg-dark-900', to: 'bg-pink-50' }
    ]
  },
  {
    file: 'src/navbar/Navbar.js',
    replaces: [
      { from: 'bg-dark-800/60', to: 'bg-white/60' },
      { from: 'border-white/10', to: 'border-pink-200' },
      { from: "color: '#a855f7'", to: "color: '#f472b6'" }
    ]
  },
  {
    file: 'src/vods/Vod.js',
    replaces: [
      { from: 'bg-dark-800/80', to: 'bg-white/80' },
      { from: 'border-white/10', to: 'border-pink-200' },
      { from: 'rgba(168,85,247,0.3)', to: 'rgba(244,114,182,0.3)' },
      { from: 'from-dark-800/50 to-dark-900/50', to: 'from-white/50 to-pink-50/50' }
    ]
  },
  {
    file: 'src/vods/Vods.js',
    replaces: [
      { from: /bg-dark-900\/50/g, to: 'bg-white/50' },
      { from: /border-white\/10/g, to: 'border-pink-200' },
      { from: /bg-dark-800\/95/g, to: 'bg-white/95' },
      { from: /bg-dark-800\/80/g, to: 'bg-white/80' },
      { from: /text-gray-200/g, to: 'text-gray-800' },
      { from: 'rgba(0,0,0,0.5)', to: 'rgba(244,114,182,0.2)' }
    ]
  },
  {
    file: 'tailwind.config.js',
    replaces: [
      { from: 'primary: "#a855f7"', to: 'primary: "#f472b6"' },
      { from: 'secondary: "#ec4899"', to: 'secondary: "#fbcfe8"' }
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
    console.log(`Updated colors in ${file}`);
  }
});
