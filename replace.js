const fs = require('fs');

const filesToUpdate = [
  'public/index.html',
  'public/manifest.json',
  'src/navbar/Navbar.js',
  'src/utils/Footer.js',
  'src/utils/NotFound.js',
  'package.json'
];

filesToUpdate.forEach(file => {
  if (fs.existsSync(file)) {
    let content = fs.readFileSync(file, 'utf8');
    
    // Replace Capitalized
    content = content.replace(/Minorikyun/g, 'Nymphelia');
    // Replace lowercase
    content = content.replace(/minorikyun/g, 'nymphelia');
    
    fs.writeFileSync(file, content, 'utf8');
    console.log(`Updated ${file}`);
  }
});
