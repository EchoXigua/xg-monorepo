const fs = require('fs');
const path = require('path');
const rimraf = require('rimraf');

function deleteNodeModules(dir) {
  fs.readdirSync(dir).forEach(file => {
    const fullPath = path.join(dir, file);
    if (fs.statSync(fullPath).isDirectory()) {
      if (file === 'node_modules') {
        rimraf.sync(fullPath);
      } else {
        deleteNodeModules(fullPath);
      }
    }
  });
}

deleteNodeModules(process.cwd());