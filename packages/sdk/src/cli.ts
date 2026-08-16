import fs from 'fs';
import path from 'path';

export function runCLI() {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command || command === 'help' || command === '--help' || command === '-h') {
    printHelp();
    return;
  }

  if (command === 'init') {
    const extName = args[1];
    if (!extName) {
      console.error('Error: Please specify the name of the extension.');
      console.log('Usage: sde-sdk init <my-extension-name>');
      process.exit(1);
    }
    initializeExtension(extName);
  } else {
    console.error(`Error: Unknown command "${command}"`);
    printHelp();
    process.exit(1);
  }
}

function printHelp() {
  console.log(`
SDE Code Extension SDK CLI v1.0.0

Usage:
  sde-sdk <command> [options]

Commands:
  init <name>    Scaffolds a new extension workspace project directory.
  help           Show this help manual.
`);
}

function initializeExtension(name: string) {
  const targetDir = path.resolve(process.cwd(), name);
  if (fs.existsSync(targetDir)) {
    console.error(`Error: Directory "${name}" already exists.`);
    process.exit(1);
  }

  console.log(`Scaffolding new SDE Code Extension: "${name}"...`);

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(targetDir, 'assets'), { recursive: true });

    const pkgJson = {
      name,
      version: '1.0.0',
      description: 'Custom developer extension for SDE Code IDE.',
      main: 'dist/index.js',
      scripts: {
        build: "tsc",
        watch: "tsc -w"
      },
      dependencies: {
        "@sde-code/sdk": "^1.0.0"
      },
      devDependencies: {
        "typescript": "^5.1.3"
      }
    };
    fs.writeFileSync(
      path.join(targetDir, 'package.json'),
      JSON.stringify(pkgJson, null, 2),
      'utf-8'
    );

    const tsConfig = {
      compilerOptions: {
        target: "ES2022",
        module: "CommonJS",
        outDir: "./dist",
        rootDir: "./src",
        strict: true,
        esModuleInterop: true,
        skipLibCheck: true
      },
      include: ["src/**/*"]
    };
    fs.writeFileSync(
      path.join(targetDir, 'tsconfig.json'),
      JSON.stringify(tsConfig, null, 2),
      'utf-8'
    );

    const manifest = {
      id: `dev.${name.replace(/\s+/g, '-').toLowerCase()}`,
      name,
      version: "1.0.0",
      description: pkgJson.description,
      publisher: "Self",
      main: "dist/index.js",
      activationEvents: ["onStartupFinished"],
      provides: ["command", "status-bar"],
      dependsOn: [],
      permissions: ["filesystem"]
    };
    fs.writeFileSync(
      path.join(targetDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2),
      'utf-8'
    );

    const boilerplate = `import { registerCommand, registerStatusBarItem } from '@sde-code/sdk';

// 1. Register custom commands
registerCommand('${manifest.id}.helloWorld', () => {
  console.log('Hello World from ${name} extension!');
});

// 2. Register status bar items
registerStatusBarItem('${manifest.id}.status', {
  text: 'Extension: Active',
  icon: '⚡',
  tooltip: '${name} runtime status',
  alignment: 'right',
  priority: 500,
  commandId: '${manifest.id}.helloWorld'
});
`;
    fs.writeFileSync(
      path.join(targetDir, 'src/index.ts'),
      boilerplate,
      'utf-8'
    );

    const readme = `# ${name} SDE Extension

This extension is built for SDE Code IDE using the SDE Developer SDK.

## How to build
1. Install node dependencies:
   \`\`\`bash
   npm install
   \`\`\`
2. Compile typescript:
   \`\`\`bash
   npm run build
   \`\`\`
3. Compress files (\`manifest.json\`, \`dist/\`, and \`assets/\`) into a \`.zip\` file to publish to SDE Marketplace.
`;
    fs.writeFileSync(
      path.join(targetDir, 'README.md'),
      readme,
      'utf-8'
    );

    console.log(`
Successfully initialized extension workspace!
To begin, run:
  cd ${name}
  npm install
  npm run build
`);

  } catch (err: any) {
    console.error('Failed to scaffold extension project:', err);
    process.exit(1);
  }
}

// Boot the CLI handler if run directly
if (require.main === module) {
  runCLI();
}
