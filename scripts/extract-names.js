const fs = require('fs');
const input = fs.readFileSync('/Users/uday/Downloads/email-outreach-app/Untitled spreadsheet - merge4.csv', 'utf8');
const lines = input.trim().split('\n');

// Skip header
const header = 'email,name,company';
const output = [header];

for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim().replace(/\r/g, '');
    if (!line) continue;

    const parts = line.split(',');
    const email = parts[0].trim();
    const company = parts.slice(1).join(',').trim();

    // Extract name from email (before @)
    const localPart = email.split('@')[0];

    // Handle common patterns: firstname.lastname, firstname_lastname, firstname
    let name = localPart
        .replace(/[._]/g, ' ')  // Replace dots and underscores with spaces
        .replace(/[0-9]/g, '')  // Remove numbers
        .split(' ')
        .filter(s => s.length > 1)  // Filter out single chars like initials
        .map(s => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())  // Title case
        .join(' ');

    // If name is too short (like 'ns', 'ca', 'dc'), use original
    if (name.length < 2) {
        name = localPart.charAt(0).toUpperCase() + localPart.slice(1);
    }

    output.push(`${email},${name},${company}`);
}

fs.writeFileSync('/Users/uday/Downloads/email-outreach-app/merge4_with_names.csv', output.join('\n'));
console.log(`Created merge4_with_names.csv with ${output.length - 1} recipients`);
