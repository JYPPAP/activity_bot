#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Function to recursively get all TypeScript files
function getAllTsFiles(dir, files = []) {
  const items = fs.readdirSync(dir);
  
  for (const item of items) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    
    if (stat.isDirectory() && !item.includes('node_modules') && !item.includes('dist')) {
      getAllTsFiles(fullPath, files);
    } else if (item.endsWith('.ts') && !item.endsWith('.d.ts')) {
      files.push(fullPath);
    }
  }
  
  return files;
}

// Function to fix imports in a file
function fixImportsInFile(filePath) {
  let content = fs.readFileSync(filePath, 'utf8');
  let modified = false;
  
  // Pattern to match imports with relative paths without .js extension
  const importPattern = /^(import\s+(?:(?:\{[^}]*\}|[\w,\s*]+)\s+from\s+|)['"](\.\.?\/[^'"]+))(?<!\.js)(['"])/gm;
  
  content = content.replace(importPattern, (match, prefix, importPath, quote) => {
    // Skip if it's importing a directory (ends with /)
    if (importPath.endsWith('/')) {
      return match;
    }
    
    // Skip if it's already has an extension
    if (importPath.match(/\.(js|json|css|scss|svg|png|jpg|jpeg|gif)$/)) {
      return match;
    }
    
    modified = true;
    return `${prefix}.js${quote}`;
  });
  
  if (modified) {
    fs.writeFileSync(filePath, content);
    console.log(`✅ Fixed imports in: ${path.relative(process.cwd(), filePath)}`);
    return true;
  }
  
  return false;
}

// Main function
function main() {
  const srcDir = path.join(__dirname, '..', 'src');
  console.log('🔍 Scanning for TypeScript files...');
  
  const tsFiles = getAllTsFiles(srcDir);
  console.log(`📁 Found ${tsFiles.length} TypeScript files`);
  
  let fixedCount = 0;
  
  for (const file of tsFiles) {
    if (fixImportsInFile(file)) {
      fixedCount++;
    }
  }
  
  console.log(`\n✨ Done! Fixed imports in ${fixedCount} files`);
}

main();