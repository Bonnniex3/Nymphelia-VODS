const fs = require('fs');
const path = require('path');

const ITEM_IDS = [
    'MINORIKYUN-2026-VODS',
    'minorikyun-subathon',
    'minorikyun-subathon2'
];
const OUTPUT_FILE = path.join(__dirname, '../src/vods/data/vods.json');
const THUMBNAILS_DIR = path.join(__dirname, '../public/thumbnails');

// Ensure thumbnails directory exists
if (!fs.existsSync(THUMBNAILS_DIR)) {
    fs.mkdirSync(THUMBNAILS_DIR, { recursive: true });
}

async function downloadThumbnail(url, filename) {
    const destPath = path.join(THUMBNAILS_DIR, filename);
    if (fs.existsSync(destPath)) {
        return `/thumbnails/${filename}`;
    }

    try {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`HTTP ${response.status} - ${response.statusText}`);
        
        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        fs.writeFileSync(destPath, buffer);
        console.log(`  -> Downloaded thumbnail: ${filename}`);
        return `/thumbnails/${filename}`;
    } catch (err) {
        console.error(`  -> Failed to download thumbnail ${url}:`, err.message);
        return url; // fallback to external url
    }
}

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
    let allVods = [];

    for (const ITEM_ID of ITEM_IDS) {
        console.log(`Fetching metadata for ${ITEM_ID}...`);
        const METADATA_URL = `https://archive.org/metadata/${ITEM_ID}`;
        const DOWNLOAD_BASE = `https://archive.org/download/${ITEM_ID}`;
        
        try {
            const response = await fetch(METADATA_URL);
            if (!response.ok) {
                console.error(`HTTP error! status: ${response.status} for ${ITEM_ID}`);
                continue;
            }
            
            const data = await response.json();
            const files = data.files;
            
            if (!files) {
                console.error(`No files found in metadata for ${ITEM_ID}.`);
                continue;
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

            const vods = await Promise.all(videoFiles.map(async file => {
                const { date, title } = parseDateAndTitle(file.name);
                
                // Construct direct download link
                const videoUrl = `${DOWNLOAD_BASE}/${encodeURIComponent(file.name)}`;
                
                // Try to find a thumbnail
                const baseName = file.name.substring(0, file.name.lastIndexOf('.'));
                
                let thumbFile = files.find(f => 
                    (f.name.includes(`${baseName}_000001.jpg`) || f.name.includes(`${baseName}.jpg`)) &&
                    f.format === 'Thumbnail'
                );
                
                if (!thumbFile) {
                     thumbFile = files.find(f => f.name.includes(baseName) && f.format === 'Thumbnail');
                }

                const thumbnailUrl = thumbFile 
                    ? `${DOWNLOAD_BASE}/${encodeURIComponent(thumbFile.name)}`
                    : `https://archive.org/services/img/${ITEM_ID}`;

                const safeFilename = `${ITEM_ID}_${file.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}.jpg`;
                const localThumbnailUrl = await downloadThumbnail(thumbnailUrl, safeFilename);

                return {
                    id: `${ITEM_ID}/${file.name}`, // Create a composite ID to avoid collisions across items
                    item_id: ITEM_ID,
                    file_name: file.name,
                    title: title || file.name,
                    createdAt: date,
                    duration: formatDuration(file.length || file.duration), 
                    thumbnail_url: localThumbnailUrl,
                    video_url: videoUrl,
                    drive: [], // Keep structure compatible
                    youtube: [],
                    games: [],
                    chapters: []
                };
            }));

            allVods = allVods.concat(vods);
            console.log(`Found ${vods.length} VODs in ${ITEM_ID}.`);

        } catch (error) {
            console.error(`Error fetching VODs for ${ITEM_ID}:`, error);
        }
    }

    try {
        // Sort all accumulated vods by date descending
        allVods.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        console.log(`\nTotal: Found ${allVods.length} VODs across all collections.`);
        
        // Write to file
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(allVods, null, 2));
        console.log(`Successfully saved to ${OUTPUT_FILE}`);
    } catch (error) {
        console.error('Error saving combined VODs:', error);
        process.exit(1);
    }
}

fetchVods();
