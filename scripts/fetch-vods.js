const fs = require('fs');
const path = require('path');

const ITEM_ID = 'MINORIKYUN-2026-VODS';
const METADATA_URL = `https://archive.org/metadata/${ITEM_ID}`;
const DOWNLOAD_BASE = `https://archive.org/download/${ITEM_ID}`;
const OUTPUT_FILE = path.join(__dirname, '../src/vods/data/vods.json');

// Helper to parse date from filename: [M-D-YY] Title...
// Example: [1-11-26] Minorikyun...
function parseDateAndTitle(filename) {
    // Regex to match [M-D-YY] or [MM-DD-YY] at start
    const dateRegex = /^\[(\d{1,2})-(\d{1,2})-(\d{2,4})\]\s*(.*?)(\.mp4|\.mkv|\.webm)$/i;
    const match = filename.match(dateRegex);

    if (match) {
        let [_, month, day, year, title] = match;
        
        // Handle 2-digit year (assume 20xx)
        if (year.length === 2) year = '20' + year;
        
        // Pad month/day
        month = month.padStart(2, '0');
        day = day.padStart(2, '0');

        return {
            date: `${year}-${month}-${day}T00:00:00.000Z`,
            title: title.trim()
        };
    }

    // Fallback if no date pattern found
    return {
        date: new Date().toISOString(), // Default to now or file creation time if available
        title: filename.replace(/(\.mp4|\.mkv|\.webm)$/i, '')
    };
}

function formatDuration(seconds) {
    if (!seconds) return "00:00:00";
    const secNum = parseInt(seconds, 10);
    const hours   = Math.floor(secNum / 3600);
    const minutes = Math.floor((secNum - (hours * 3600)) / 60);
    const secs    = secNum - (hours * 3600) - (minutes * 60);

    const hDisplay = hours.toString().padStart(2, '0');
    const mDisplay = minutes.toString().padStart(2, '0');
    const sDisplay = secs.toString().padStart(2, '0');
    
    return `${hDisplay}:${mDisplay}:${sDisplay}`;
}

async function fetchVods() {
    console.log(`Fetching metadata for ${ITEM_ID}...`);
    
    try {
        const response = await fetch(METADATA_URL);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        const data = await response.json();
        const files = data.files;
        
        if (!files) {
            console.error('No files found in metadata.');
            return;
        }

        // Filter for video files (mp4, mkv, webm) and exclude derivatives/thumbnails
        const videoFiles = files.filter(file => {
            const name = file.name.toLowerCase();
            const isVideo = name.endsWith('.mp4') || name.endsWith('.mkv') || name.endsWith('.webm');
            
            // Exclude common derivative suffixes
            if (name.endsWith('.ia.mp4')) return false; 
            if (name.endsWith('.512kb.mp4')) return false;
            
            return isVideo && file.format !== 'Thumbnail' && file.format !== 'Metadata' && file.size > 1000000; // >1MB
        });

        const vods = videoFiles.map(file => {
            const { date, title } = parseDateAndTitle(file.name);
            
            // Construct direct download link
            // The file.name in the metadata response is the path relative to the item root
            const videoUrl = `${DOWNLOAD_BASE}/${encodeURIComponent(file.name)}`;
            
            // Try to find a thumbnail
            // Archive.org usually creates a thumbnail with suffix .thumbs/[filename]_000001.jpg
            // The 'files' array usually contains these thumbnail files explicitly
            
            // 1. Try to find a file that starts with the video filename (minus extension) and ends in .jpg
            const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
            
            let thumbFile = files.find(f => 
                (f.name.includes(`${baseName}_000001.jpg`) || f.name.includes(`${baseName}.jpg`)) &&
                f.format === 'Thumbnail'
            );
            
            // 2. Fallback: try to find any thumbnail that contains the base name
            if (!thumbFile) {
                 thumbFile = files.find(f => f.name.includes(baseName) && f.format === 'Thumbnail');
            }

            const thumbnailUrl = thumbFile 
                ? `${DOWNLOAD_BASE}/${encodeURIComponent(thumbFile.name)}`
                : `https://archive.org/services/img/${ITEM_ID}`;

            return {
                id: file.name, // Use filename as unique ID
                title: title || file.name,
                createdAt: date,
                duration: formatDuration(file.length || file.duration), 
                thumbnail_url: thumbnailUrl,
                video_url: videoUrl,
                drive: [], // Keep structure compatible
                youtube: [],
                games: [],
                chapters: []
            };
        });

        // Sort by date descending
        vods.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        console.log(`Found ${vods.length} VODs.`);
        
        // Write to file
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(vods, null, 2));
        console.log(`Successfully saved to ${OUTPUT_FILE}`);

    } catch (error) {
        console.error('Error fetching VODs:', error);
        process.exit(1);
    }
}

fetchVods();
