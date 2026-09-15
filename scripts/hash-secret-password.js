// Read from stdin so a password never appears in command-line arguments.
const { hashPassword } = require('../lib/secretMode');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
    input += chunk;
    if (input.length > 2048) { process.stderr.write('Password is too long\n'); process.exit(1); }
});
process.stdin.on('end', () => {
    const password = input.replace(/\r?\n$/, '');
    if (!password || password.length > 1024) { process.stderr.write('Password must contain 1 to 1024 characters\n'); process.exitCode = 1; return; }
    process.stdout.write(hashPassword(password) + '\n');
});
