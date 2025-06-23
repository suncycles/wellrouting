// Global variables
let csvData = [];
let isCSVLoaded = false;

// Function to extract plate position number from location string
function extractPlatePosition(locationString) {
    if (!locationString) {
        console.log(`    extractPlatePosition: null input`);
        return null;
    }
    
    // Extract the rightmost number from the string
    const match = locationString.match(/(\d+)(?=\D*$)/);
    if (match) {
        const result = parseInt(match[1]);
        //console.log(`    extractPlatePosition: '${locationString}' → ${result}`);
        return result;
    }
    return null;
}


// Function to load and parse CSV file
async function loadCSVFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = function(e) {
            const csv = e.target.result;
            const lines = csv.split('\n');
            // Headers: Trim whitespace AND remove leading/trailing double quotes
            const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
            
            const data = [];
            for (let i = 1; i < lines.length; i++) {
                if (lines[i].trim()) {
                    // Values: Trim whitespace AND remove leading/trailing double quotes
                    const values = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
                    const row = {};
                    headers.forEach((header, index) => {
                        let value = values[index] || '';
                    
                        if (header === 'Dest_Plate_Location' || header === 'Source_Plate_Location') {
                            const extractedPosition = extractPlatePosition(value);
                            if (extractedPosition !== null) {
                                value = extractedPosition;
                                //console.log(`Converted ${header}: original='${values[index]}' → extracted='${value}'`);
                            }
                        }
                        
                        row[header] = value;
                    });
                    data.push(row);
                }
            }
            resolve(data);
        };
        reader.onerror = reject;
        reader.readAsText(file);
    });
}

// Function to extract plate number from location string (now expects just the number)
function extractPlateNumber(locationString) {
    if (!locationString) {
        console.log(`    extractPlateNumber: null input`);
        return null;
    }
    
    // Since we now store just the position number, parse it directly
    const result = parseInt(locationString);
    if (isNaN(result)) {
        console.log(`    extractPlateNumber: '${locationString}' → null (not a number)`);
        return null;
    }
    
    console.log(`    extractPlateNumber: '${locationString}' → ${result}`);
    return result;
}

// Function to clear all highlights
function clearHighlights() {
    document.querySelectorAll('.highlight').forEach(el => {
        el.classList.remove('highlight');
    });
    document.querySelectorAll('.clicked-well').forEach(el => {
        el.classList.remove('clicked-well');
    });
    document.querySelector('#selected-oligos').innerHTML = '';
    document.querySelector('#associated-oligos').innerHTML = '';

}

// Function to add highlight class to element
function highlightElement(elementId) {
    const element = document.getElementById(elementId);
    if (element) {
        element.classList.add('highlight');
        console.log(`      ✓ Successfully highlighted: ${elementId}`);
    } else {
        console.warn(`      ✗ Element not found in DOM: ${elementId}`);
    }
}

function searchAndHighlight(clickedWell, clickedPlateType, clickedPlateNumber) {
    if (!isCSVLoaded || csvData.length === 0) {
        console.warn('CSV data not loaded');
        return;
    }
    let matchesFound = 0;
    let totalRowsProcessed = 0;

    // // add the clicked well's oligo name
    // csvData.forEach(row => {
    //     const sourceWell = row.Source_Well;
    //     const destWell = row.Dest_Well;
    //     const sourcePlateNum = row.Source_Plate_Location;
    //     const destPlateNum = row.Dest_Plate_Location;
    //     const oligoName = row.Oligo_name;

    //     if (clickedPlateType === 'SP'){
    //         if(sourceWell === clickedWell && sourcePlateNum === clickedPlateNumber){
    //             addOligoToList(oligoName, 'selected-oligos');
    //             return;
    //         }
    //     } else if(clickedPlateType === 'DP'){
    //         if(destWell === clickedWell && destPlateNum === clickedPlateNumber) {
    //             addOligoToList(oligoName, 'selected-oligos');
    //             return;
    //         }
    //     } 
    // });


    // Search through CSV data
    csvData.forEach((row, index) => {
        totalRowsProcessed++;
        // Access properties directly without extra quotes around the keys
        const sourceWell = row.Source_Well;
        const destWell = row.Dest_Well;
        const destLocation = row.Dest_Plate_Location; // This is the number directly
        const sourceLocation = row.Source_Plate_Location; // This is the number directly
        const oligoName = row.Oligo_name;

        // Plate numbers are directly available from the row data, no extraction needed
        const sourcePlateNum = sourceLocation;
        const destPlateNum = destLocation;

        console.log(`Row ${index + 1}: Source=${sourceWell}@Location ${sourceLocation}(Plate ${sourcePlateNum}), Dest=${destWell}@Location ${destLocation}(Plate ${destPlateNum})`);

        if (clickedPlateType === 'SP') {
            // Clicked on a Source Plate well: Find its destinations
            console.log(`  Checking if source well '${sourceWell}' === '${clickedWell}' AND plate ${sourcePlateNum} === ${clickedPlateNumber}`);
            // Ensure types match for comparison if clickedPlateNumber could be string
            if (sourceWell === clickedWell && sourcePlateNum === clickedPlateNumber) {
                matchesFound++;
                console.log(`  ✓ MATCH FOUND! (Clicked SP is Source) Row ${index + 1}`);
                console.log(`    Source (clicked): ${sourceWell} on plate ${sourcePlateNum}`);
                console.log(`    Destination: ${destWell} on plate ${destPlateNum}`);
                
                // Highlight the corresponding destination well
                if (destWell && destPlateNum) {
                    const destElementId = `DP${destPlateNum}_${destWell}`;
                    console.log(`    → Highlighting destination: ${destElementId}`);
                    highlightElement(destElementId);
                    addOligoToList(oligoName, 'associated-oligos');
                } else {
                    console.log(`    ⚠ Missing destination data: destWell='${destWell}', destPlateNum=${destPlateNum}`);
                }
            }
        } else if (clickedPlateType === 'DP') {
            // Clicked on a Destination Plate well: Find its sources
            console.log(`  Checking if dest well '${destWell}' === '${clickedWell}' AND plate ${destPlateNum} === ${clickedPlateNumber}`);
            // Ensure types match for comparison if clickedPlateNumber could be string
            if (destWell === clickedWell && destPlateNum === clickedPlateNumber) {
                matchesFound++;
                console.log(`  ✓ MATCH FOUND! (Clicked DP is Destination) Row ${index + 1}`);
                console.log(`    Destination (clicked): ${destWell} on plate ${destPlateNum}`);
                console.log(`    Source: ${sourceWell} on plate ${sourcePlateNum}`);
                
                // Highlight the corresponding source well
                if (sourceWell && sourcePlateNum) {
                    const sourceElementId = `SP${sourcePlateNum}_${sourceWell}`;
                    console.log(`    → Highlighting source: ${sourceElementId}`);
                    highlightElement(sourceElementId);
                    addOligoToList(oligoName, 'associated-oligos');
                } else {
                    console.log(`    ⚠ Missing source data: sourceWell='${sourceWell}', sourcePlateNum=${sourcePlateNum}`);
                }
            }
        }
    });

    console.log(`=== SEARCH COMPLETE ===`);
    console.log(`Processed ${totalRowsProcessed} rows`);
    console.log(`Found ${matchesFound} matches`);
    console.log(`========================`);
}

// Function to parse element ID and extract plate info
function parseElementId(elementId) {
    // Format: SP1_A1 or DP1_A8
    const match = elementId.match(/^(SP|DP)(\d+)_([A-H]\d+)$/);
    if (match) {
        return {
            plateType: match[1],
            plateNumber: parseInt(match[2]),
            wellPosition: match[3]
        };
    }
    return null;
}

// Function to handle well click events
function handleWellClick(event) {
    const wellElement = event.target;
    const elementId = wellElement.id;

    if (!elementId) {
        console.warn('Well element has no ID');
        return;
    }

    const plateInfo = parseElementId(elementId);
    console.log(`Parsed plate info:`, plateInfo);
    
    if (!plateInfo) {
        console.warn('Invalid element ID format:', elementId);
        return;
    }
    wellElement.classList.add('clicked-well');
    // Perform search and highlight
    searchAndHighlight(plateInfo.wellPosition, plateInfo.plateType, plateInfo.plateNumber);
    //console.log("<---- Searching and Highlighting:"+plateInfo.wellPosition+plateInfo.plateType+ plateInfo.plateNumber+"--->\n");
}

// Function to attach click events to all wells
function attachWellClickEvents() {
    // Find all elements with IDs matching the pattern SP#_## or DP#_##
    const wellElements = document.querySelectorAll('[id^="SP"], [id^="DP"]');
    
    wellElements.forEach(element => {
        // Check if the ID matches our expected format
        if (element.id.match(/^(SP|DP)\d+_[A-H]\d+$/)) {
            element.addEventListener('click', handleWellClick);
            element.style.cursor = 'pointer';
            //console.log(`Attached click event to: ${element.id}`);
        }
    });
    
    //console.log(`Attached click events to ${wellElements.length} well elements`);
}
//append oligo text to list at the bottom
function addOligoToList(oligoName, listType){
    var entry = document.createElement('li');
    entry.appendChild(document.createTextNode(oligoName));
    document.getElementById(listType).appendChild(entry);
}
// Function to initialize the system
function initializeWellSearch() {
    // Create file input for CSV loading
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
                console.log(`CSV loaded successfully. ${csvData.length} rows found.`);
                console.log('Sample data:', csvData.slice(0, 3));
                console.log('Expected columns: Source_Well, Dest_Well, Volume, Dest_Plate_Location, Source_Plate_Location');
                console.log('Note: Volume column and columns after Source_Plate_Location are ignored');
                console.log('Location columns have been processed to extract position numbers only');
            } catch (error) {
                console.error('Error loading CSV:', error);
                alert('Error loading CSV file. Please check the file format.');
            }
        }
    });

    // Create load CSV button
    const loadButton = document.createElement('button');
    loadButton.textContent = 'Load CSV File';
    loadButton.style.cssText = `
        position: fixed;
        top: 10px;
        left: 10px;
        padding: 10px 15px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        z-index: 1001;
        font-size: 12px;
    `;
    
    loadButton.addEventListener('click', () => {
        fileInput.click();
    });
    
    document.body.appendChild(loadButton);

    // Create clear highlights button
    const clearButton = document.createElement('button');
    clearButton.textContent = 'Clear Highlights';
    clearButton.style.cssText = `
        position: fixed;
        top: 50px;
        left: 10px;
        padding: 10px 15px;
        background: #FF5722;
        color: white;
        border: none;
        border-radius: 5px;
        cursor: pointer;
        z-index: 1001;
        font-size: 12px;
    `;
    
    clearButton.addEventListener('click', clearHighlights);
    document.body.appendChild(clearButton);

    // Attach click events to wells
    attachWellClickEvents();
    
    console.log('Well search system initialized');
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.source-plates .well').forEach(e=>{
        e.classList.add('disabled');
    });

    initializeWellSearch();

    document.querySelectorAll('.well').forEach(well => {
        const id = well.id;
        const match = id.match(/SP[1-5]_([A-Z]\d+)/);
        well.textContent = match[1];
        well.classList.remove('disabled');
    });
});
