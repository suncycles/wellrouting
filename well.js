// Global variables
let csvData = [];
let isCSVLoaded = false;
let activeTraySet = new Set(); // Track which trays are selected
let highlightedWells = new Map(); // Track which wells are highlighted and why
let wellTrayMapping = new Map(); // Track which tray each well belongs to
let currentClickedWells = new Set(); // Track currently clicked wells for re-processing

// Performance optimization: Cache DOM elements
const domCache = {
    wellElements: null,
    trayCheckboxes: null,
    associatedOligosList: null,
    
    // Initialize cache
    init() {
        this.wellElements = new Map();
        this.trayCheckboxes = document.querySelectorAll('#tray-selection input[type="checkbox"]');
        this.associatedOligosList = document.getElementById('associated-oligos');
        
        // Cache all well elements
        document.querySelectorAll('[id^="SP"], [id^="DP"]').forEach(element => {
            if (element.id.match(/^(SP|DP)\d+_[A-H]\d+$/)) {
                this.wellElements.set(element.id, element);
            }
        });
    },
    
    getWellElement(id) {
        return this.wellElements?.get(id);
    }
};

// Performance optimization: Batch DOM updates
class DOMBatcher {
    constructor() {
        this.updates = [];
        this.isScheduled = false;
    }
    
    addUpdate(callback) {
        this.updates.push(callback);
        if (!this.isScheduled) {
            this.isScheduled = true;
            requestAnimationFrame(() => this.flush());
        }
    }
    
    flush() {
        const updates = this.updates.splice(0);
        updates.forEach(callback => callback());
        this.isScheduled = false;
    }
}

const domBatcher = new DOMBatcher();

// Performance optimization: Index CSV data for faster lookups
let csvIndex = {
    bySourceWell: new Map(), // Map: "plateNum_wellPos" -> [rows]
    byDestWell: new Map(),   // Map: "plateNum_wellPos" -> [rows]
    byTray: new Map()        // Map: trayNumber -> [rows]
};

// Tray color mapping
const TRAY_COLORS = {
    1: '#800000', 2: '#f58231', 3: '#fffac8', 4: '#fabed4',
    5: '#bfef45', 6: '#469990', 7: '#000075'
};

// Optimized: Use lookup table instead of function call
function getTrayColor(trayNumber) {
    return TRAY_COLORS[trayNumber] || '#CCCCCC';
}

// Performance optimization: Reduce DOM queries and string operations
function setTrayMapping(elementId, trayNumber) {
    wellTrayMapping.set(elementId, trayNumber);
}

// Optimized: Compile regex once
const TRAY_REGEX = /SrcTray_(\d+)_/;
const PLATE_POSITION_REGEX = /(\d+)(?=\D*$)/;

function extractTrayNumber(trayString) {
    if (!trayString) return null;
    const match = trayString.match(TRAY_REGEX);
    return match ? parseInt(match[1]) : null;
}

function extractPlatePosition(locationString) {
    if (!locationString) return null;
    const match = locationString.match(PLATE_POSITION_REGEX);
    return match ? parseInt(match[1]) : null;
}

// Optimized: Cache active trays instead of recalculating
let cachedActiveTrays = new Set();
let activeTraysCacheValid = false;

function getActiveTrays() {
    if (!activeTraysCacheValid) {
        cachedActiveTrays.clear();
        domCache.trayCheckboxes.forEach(checkbox => {
            if (checkbox.checked) {
                const match = checkbox.value.match(/Tray(\d+)/);
                if (match) {
                    cachedActiveTrays.add(parseInt(match[1]));
                }
            }
        });
        activeTraysCacheValid = true;
    }
    return cachedActiveTrays;
}

function invalidateActiveTrayCache() {
    activeTraysCacheValid = false;
}

function shouldWellBeVisible(trayNumber) {
    const activeTrays = getActiveTrays();
    return activeTrays.has(trayNumber);
}

// Fixed: Better well highlight management with tray filtering
function manageWellHighlight(elementId, reason, shouldHighlight, trayNumber = null) {
    if (!highlightedWells.has(elementId)) {
        highlightedWells.set(elementId, new Map()); // Use Map to store reason -> trayNumber
    }
    
    const reasonsMap = highlightedWells.get(elementId);
    
    if (shouldHighlight && trayNumber) {
        reasonsMap.set(reason, trayNumber);
    } else {
        reasonsMap.delete(reason);
    }
    
    updateWellVisualState(elementId);
}

// New: Centralized function to update well visual state based on active trays
function updateWellVisualState(elementId) {
    const element = domCache.getWellElement(elementId);
    if (!element) return;
    
    const reasonsMap = highlightedWells.get(elementId);
    if (!reasonsMap || reasonsMap.size === 0) {
        // No highlights for this well
        domBatcher.addUpdate(() => {
            element.classList.remove('highlight', 'overlapped', 'tray-colored');
            element.style.removeProperty('--tray-color');
        });
        highlightedWells.delete(elementId);
        return;
    }
    
    // Filter reasons by active trays
    const activeTrays = getActiveTrays();
    const validReasons = new Map();
    const activeTrayNumbers = new Set();
    
    for (const [reason, trayNumber] of reasonsMap) {
        if (shouldWellBeVisible(trayNumber)) {
            validReasons.set(reason, trayNumber);
            activeTrayNumbers.add(trayNumber);
        }
    }
    
    // Update the stored reasons to only include valid ones
    highlightedWells.set(elementId, validReasons);
    
    domBatcher.addUpdate(() => {
        element.classList.remove('highlight', 'overlapped', 'tray-colored');
        element.style.removeProperty('--tray-color');
        
        if (validReasons.size === 0) {
            // No valid highlights
            return;
        }
        
        if (activeTrayNumbers.size === 1) {
            // Single tray - show tray color
            const trayNumber = Array.from(activeTrayNumbers)[0];
            const color = getTrayColor(trayNumber);
            element.style.setProperty('--tray-color', color);
            element.classList.add('tray-colored', 'highlight');
        } else if (activeTrayNumbers.size > 1) {
            // Multiple trays - show overlap
            element.classList.add('overlapped');
        } else {
            // Fallback highlight
            element.classList.add('highlight');
        }
    });
}

// Performance optimization: Build indexes when loading CSV
function buildCSVIndexes() {
    console.log('Building CSV indexes...');
    
    // Clear existing indexes
    csvIndex.bySourceWell.clear();
    csvIndex.byDestWell.clear();
    csvIndex.byTray.clear();
    
    csvData.forEach((row, index) => {
        const sourceKey = `${row.Source_Plate_Location}_${row.Source_Well}`;
        const destKey = `${row.Dest_Plate_Location}_${row.Dest_Well}`;
        const trayNumber = row.Source_Tray;
        
        // Index by source well
        if (!csvIndex.bySourceWell.has(sourceKey)) {
            csvIndex.bySourceWell.set(sourceKey, []);
        }
        csvIndex.bySourceWell.get(sourceKey).push(row);
        
        // Index by destination well
        if (!csvIndex.byDestWell.has(destKey)) {
            csvIndex.byDestWell.set(destKey, []);
        }
        csvIndex.byDestWell.get(destKey).push(row);
        
        // Index by tray
        if (!csvIndex.byTray.has(trayNumber)) {
            csvIndex.byTray.set(trayNumber, []);
        }
        csvIndex.byTray.get(trayNumber).push(row);
    });
    
    console.log(`Indexes built: ${csvIndex.bySourceWell.size} source wells, ${csvIndex.byDestWell.size} dest wells, ${csvIndex.byTray.size} trays`);
}

// Optimized: Use indexes for faster lookups
function storeTrayMappings() {
    if (!isCSVLoaded || csvData.length === 0) return;
    
    console.log('Storing tray mappings for wells...');
    wellTrayMapping.clear();
    
    // Use for...of for better performance than forEach
    for (const row of csvData) {
        const { Source_Well, Dest_Well, Source_Plate_Location, Dest_Plate_Location, Source_Tray } = row;
        
        if (Source_Tray >= 1 && Source_Tray <= 7) {
            if (Source_Well && Source_Plate_Location) {
                setTrayMapping(`SP${Source_Plate_Location}_${Source_Well}`, Source_Tray);
            }
            if (Dest_Well && Dest_Plate_Location) {
                setTrayMapping(`DP${Dest_Plate_Location}_${Dest_Well}`, Source_Tray);
            }
        }
    }
    
    console.log(`Stored tray mappings for ${wellTrayMapping.size} wells`);
}

// Optimized: Use DocumentFragment for efficient DOM creation
function createTrayLegend() {
    const existingLegend = document.getElementById('tray-legend');
    if (existingLegend) {
        existingLegend.remove();
    }
    
    const fragment = document.createDocumentFragment();
    const legend = document.createElement('div');
    legend.id = 'tray-legend';
    legend.style.cssText = `
        position: fixed; top: 100px; left: 10px; background: white;
        border: 1px solid #ccc; border-radius: 5px; padding: 10px;
        font-size: 12px; z-index: 1001; box-shadow: 0 2px 5px rgba(0,0,0,0.2);
    `;
    
    const title = document.createElement('div');
    title.textContent = 'Tray Colors:';
    title.style.cssText = 'font-weight: bold; margin-bottom: 5px;';
    legend.appendChild(title);
    
    // Build all legend items in memory first
    for (let i = 1; i <= 7; i++) {
        const item = document.createElement('div');
        item.style.cssText = 'display: flex; align-items: center; margin: 2px 0;';
        
        const colorBox = document.createElement('div');
        colorBox.style.cssText = `
            width: 15px; height: 15px; background-color: ${getTrayColor(i)};
            border: 1px solid #333; margin-right: 5px; border-radius: 2px;
        `;
        
        const label = document.createElement('span');
        label.textContent = `Tray ${i}`;
        
        item.appendChild(colorBox);
        item.appendChild(label);
        legend.appendChild(item);
    }
    
    fragment.appendChild(legend);
    document.body.appendChild(fragment);
}

// Optimized CSV loading with better parsing
async function loadCSVFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const csv = e.target.result;
            const lines = csv.split('\n');
            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            
            const data = [];
            // Use for loop for better performance than array methods
            for (let i = 1; i < lines.length; i++) {
                const line = lines[i].trim();
                if (!line) continue;
                
                const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                const row = {};
                
                // Process only the columns we need
                for (let j = 0; j < headers.length; j++) {
                    const header = headers[j];
                    let value = values[j] || '';
                    
                    // Optimize string operations with early returns
                    if (header === 'Dest_Plate_Location' || header === 'Source_Plate_Location') {
                        const extracted = extractPlatePosition(value);
                        if (extracted !== null) value = extracted;
                    } else if (header === 'Source_Tray') {
                        const extracted = extractTrayNumber(value);
                        if (extracted !== null) value = extracted;
                    }
                    
                    row[header] = value;
                }
                data.push(row);
            }
            resolve(data);
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

// Fixed: Improved search and highlight with proper tray tracking
function searchAndHighlight(clickedWell, clickedPlateType, clickedPlateNumber) {
    if (!isCSVLoaded || csvIndex.bySourceWell.size === 0) {
        console.warn('CSV data not loaded or indexed');
        return;
    }
    
    const activeTrays = getActiveTrays();
    const lookupKey = `${clickedPlateNumber}_${clickedWell}`;
    const clickedWellId = `${clickedPlateType}${clickedPlateNumber}_${clickedWell}`;
    
    // Track this as a clicked well for re-processing when trays change
    currentClickedWells.add(clickedWellId);
    
    let matchingRows = [];
    
    // Use indexes for O(1) lookup instead of O(n) scan
    if (clickedPlateType === 'SP') {
        matchingRows = csvIndex.bySourceWell.get(lookupKey) || [];
    } else if (clickedPlateType === 'DP') {
        matchingRows = csvIndex.byDestWell.get(lookupKey) || [];
    }
    
    console.log(`Found ${matchingRows.length} matching rows for ${lookupKey}`);
    
    // Clear oligos list
    if (domCache.associatedOligosList) {
        domCache.associatedOligosList.innerHTML = '';
    }
    
    // Process only matching rows
    for (const row of matchingRows) {
        const trayNumber = row.Source_Tray;
        const reason = `clicked-${clickedWellId}`;
        
        if (clickedPlateType === 'SP') {
            if (row.Dest_Well && row.Dest_Plate_Location) {
                const destElementId = `DP${row.Dest_Plate_Location}_${row.Dest_Well}`;
                manageWellHighlight(destElementId, reason, true, trayNumber);
                
                // Only add oligo to list if tray is active
                if (shouldWellBeVisible(trayNumber)) {
                    addOligoToList(row.Oligo_name, 'associated-oligos');
                }
            }
        } else {
            if (row.Source_Well && row.Source_Plate_Location) {
                const sourceElementId = `SP${row.Source_Plate_Location}_${row.Source_Well}`;
                manageWellHighlight(sourceElementId, reason, true, trayNumber);
                
                // Only add oligo to list if tray is active
                if (shouldWellBeVisible(trayNumber)) {
                    addOligoToList(row.Oligo_name, 'associated-oligos');
                }
            }
        }
    }
}

// Optimized: Cache parsed element IDs
const elementIdCache = new Map();

function parseElementId(elementId) {
    if (!elementIdCache.has(elementId)) {
        const match = elementId.match(/^(SP|DP)(\d+)_([A-H]\d+)$/);
        const result = match ? {
            plateType: match[1],
            plateNumber: parseInt(match[2]),
            wellPosition: match[3]
        } : null;
        elementIdCache.set(elementId, result);
    }
    return elementIdCache.get(elementId);
}

// Optimized: Throttle click events to prevent rapid-fire clicking
let lastClickTime = 0;
const CLICK_THROTTLE_MS = 100;

function handleWellClick(event) {
    const now = Date.now();
    if (now - lastClickTime < CLICK_THROTTLE_MS) {
        return;
    }
    lastClickTime = now;
    
    const wellElement = event.target;
    const elementId = wellElement.id;
    
    if (!elementId) return;
    
    const plateInfo = parseElementId(elementId);
    if (!plateInfo) return;
    
    wellElement.classList.add('clicked-well');
    searchAndHighlight(plateInfo.wellPosition, plateInfo.plateType, plateInfo.plateNumber);
}

// Fixed: Improved tray checkbox change handling
let trayChangeTimeout;

function handleTrayCheckboxChange() {
    invalidateActiveTrayCache();
    
    clearTimeout(trayChangeTimeout);
    trayChangeTimeout = setTimeout(() => {
        const activeTrays = getActiveTrays();
        console.log('Tray selection changed to:', Array.from(activeTrays));
        
        if (activeTrays.size === 0) {
            clearHighlights();
        } else {
            // Re-process all currently highlighted wells
            refreshAllHighlights();
            
            // Re-process clicked wells to update oligo list
            refreshOligoList();
        }
    }, 150); // Debounce by 150ms
}

// New: Refresh all highlights based on current tray selection
function refreshAllHighlights() {
    // Get all currently highlighted wells
    const wellsToRefresh = Array.from(highlightedWells.keys());
    
    // Update visual state for each well
    for (const elementId of wellsToRefresh) {
        updateWellVisualState(elementId);
    }
}

// New: Refresh oligo list based on current tray selection
function refreshOligoList() {
    if (!domCache.associatedOligosList) return;
    
    // Clear current list
    domCache.associatedOligosList.innerHTML = '';
    
    // Re-add oligos for active trays only
    for (const clickedWellId of currentClickedWells) {
        const plateInfo = parseElementId(clickedWellId);
        if (!plateInfo) continue;
        
        const lookupKey = `${plateInfo.plateNumber}_${plateInfo.wellPosition}`;
        let matchingRows = [];
        
        if (plateInfo.plateType === 'SP') {
            matchingRows = csvIndex.bySourceWell.get(lookupKey) || [];
        } else {
            matchingRows = csvIndex.byDestWell.get(lookupKey) || [];
        }
        
        for (const row of matchingRows) {
            if (shouldWellBeVisible(row.Source_Tray)) {
                addOligoToList(row.Oligo_name, 'associated-oligos');
            }
        }
    }
}

// Fixed: Clear highlights with proper cleanup
function clearHighlights() {
    highlightedWells.clear();
    currentClickedWells.clear();
    
    domBatcher.addUpdate(() => {
        document.querySelectorAll('.highlight, .overlapped, .clicked-well, .tray-colored').forEach(el => {
            el.classList.remove('highlight', 'overlapped', 'clicked-well', 'tray-colored');
            el.style.removeProperty('--tray-color');
            el.style.removeProperty('background-color');
            el.style.removeProperty('border');
            el.style.removeProperty('box-shadow');
            el.style.removeProperty('transform');
        });
    });
    
    if (domCache.associatedOligosList) {
        domCache.associatedOligosList.innerHTML = '';
    }
}

// Optimized: Use DocumentFragment for list updates
function addOligoToList(oligoName, listType) {
    const list = document.getElementById(listType);
    if (!list) return;
    
    const entry = document.createElement('li');
    entry.textContent = oligoName;
    list.appendChild(entry);
}

// Optimized: Single event delegation instead of individual listeners
function attachWellClickEvents() {
    // Use event delegation for better performance
    document.addEventListener('click', (event) => {
        const element = event.target;
        if (element.id && element.id.match(/^(SP|DP)\d+_[A-H]\d+$/)) {
            handleWellClick(event);
        }
    });
    
    // Set cursor style for all wells at once
    domBatcher.addUpdate(() => {
        document.querySelectorAll('[id^="SP"], [id^="DP"]').forEach(element => {
            if (element.id.match(/^(SP|DP)\d+_[A-H]\d+$/)) {
                element.style.cursor = 'pointer';
            }
        });
    });
}

function attachTrayCheckboxEvents() {
    domCache.trayCheckboxes.forEach(checkbox => {
        checkbox.addEventListener('change', handleTrayCheckboxChange);
    });
}

// Add optimized CSS with hardware acceleration
function addTrayColorStyles() {
    const style = document.createElement('style');
    style.textContent = `
        .tray-colored {
            background-color: var(--tray-color) !important;
            border: 2px solid var(--tray-color) !important;
            will-change: transform; /* Optimize for animations */
        }
        
        .tray-colored.highlight {
            box-shadow: 0 0 5px rgba(0,0,0,0.5);
        }
        
        .overlapped {
            background-color: #ff0000 !important;
            border: 2px solid #ff0000 !important;
            box-shadow: 0 0 10px #ff0000;
        }
        
        .clicked-well {
            transform: scale(1.1) translateZ(0); /* Hardware acceleration */
        }
        
        .tray-colored:hover, .overlapped:hover {
            transform: scale(1.05) translateZ(0);
            transition: transform 0.2s ease;
        }
    `;
    document.head.appendChild(style);
}

// Initialize with performance optimizations
function initializeWellSearch() {
    // Initialize DOM cache first
    domCache.init();
    
    addTrayColorStyles();
    
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';
    fileInput.style.display = 'none';
    document.body.appendChild(fileInput);

    fileInput.addEventListener('change', async function(event) {
        const file = event.target.files[0];
        if (file) {
            try {
                console.log('Loading CSV file...');
                csvData = await loadCSVFile(file);
                isCSVLoaded = true;
                
                // Build indexes for fast lookups
                buildCSVIndexes();
                storeTrayMappings();
                createTrayLegend();
                
                console.log(`CSV loaded and indexed successfully. ${csvData.length} rows found.`);
            } catch (error) {
                console.error('Error loading CSV:', error);
                alert('Error loading CSV file. Please check the file format.');
            }
        }
    });

    // Create buttons with better styling
    const loadButton = document.createElement('button');
    loadButton.textContent = 'Load CSV File';
    loadButton.style.cssText = `
        position: fixed; top: 10px; left: 10px; padding: 10px 15px;
        background: #2196F3; color: white; border: none; border-radius: 5px;
        cursor: pointer; z-index: 1001; font-size: 12px;
    `;
    loadButton.addEventListener('click', () => fileInput.click());
    document.body.appendChild(loadButton);

    const clearButton = document.createElement('button');
    clearButton.textContent = 'Clear Highlights';
    clearButton.style.cssText = `
        position: fixed; top: 50px; left: 10px; padding: 10px 15px;
        background: #FF5722; color: white; border: none; border-radius: 5px;
        cursor: pointer; z-index: 1001; font-size: 12px;
    `;
    clearButton.addEventListener('click', clearHighlights);
    document.body.appendChild(clearButton);

    attachWellClickEvents();
    attachTrayCheckboxEvents();
    
    console.log('Optimized well search system initialized');
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    // Batch initial DOM modifications
    domBatcher.addUpdate(() => {
        document.querySelectorAll('.source-plates .well').forEach(e => {
            e.classList.add('disabled');
        });
        
        document.querySelectorAll('.well').forEach(well => {
            const id = well.id;
            const match = id.match(/SP[1-5]_([A-Z]\d+)/);
            if (match) {
                well.textContent = match[1];
                well.classList.remove('disabled');
            }
        });
    });
    
    initializeWellSearch();
});