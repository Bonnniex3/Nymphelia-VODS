const fs = require('fs');
const metadata = require('./tool_output_metadata.json');

const files = metadata.files;
const videoFile = files.find(f => f.name.endsWith('.mp4') && !f.name.includes('.ia.mp4'));

console.log(JSON.stringify(videoFile, null, 2));
