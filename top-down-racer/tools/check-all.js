/* Runs every check in one go. No dependencies, no test runner — just node.
   Run with: node tools/check-all.js */
'use strict';

var path = require('path');
var execFileSync = require('child_process').execFileSync;

var checks = ['check-track.js', 'check-physics.js', 'check-race.js'];
var failed = [];

checks.forEach(function (name) {
  console.log('\n=== ' + name + ' ' + '='.repeat(Math.max(0, 56 - name.length)));
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, name)], { encoding: 'utf8' }));
  } catch (err) {
    process.stdout.write(err.stdout || '');
    process.stderr.write(err.stderr || '');
    failed.push(name);
  }
});

console.log('\n' + '='.repeat(60));
if (failed.length) {
  console.log(failed.length + ' of ' + checks.length + ' checks failed: ' + failed.join(', '));
  process.exit(1);
}
console.log('all ' + checks.length + ' checks passed');
